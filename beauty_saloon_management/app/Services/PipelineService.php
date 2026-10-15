<?php

namespace App\Services;

use App\Models\Invoice;
use App\Models\Opportunity;
use App\Models\OpportunityDocument;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Throwable;

class PipelineService
{
    public function create(User $actor, array $input): Opportunity
    {
        abort_unless($actor->active, 403);
        $this->checkAssignment($actor, $input, $actor->id);
        $data = Validator::make($input, $this->detailRules() + [
            'client_id' => ['required', 'integer', 'exists:clients,id'],
            'assigned_to' => ['nullable', 'integer', Rule::exists('users', 'id')->where('active', true)],
        ])->validate();
        $data['assigned_to'] = $data['assigned_to'] ?? $actor->id;
        $data['next_follow_up_at'] = $this->followUpTime($data['next_follow_up_at']);

        return DB::transaction(function () use ($actor, $data) {
            $opportunity = Opportunity::create($data + [
                'created_by' => $actor->id,
                'reference' => 'ENQ-'.Str::upper(Str::random(10)),
                'stage' => 'lead',
                'stage_entered_at' => now(),
                'stage_details' => ['lead' => ['occurred_on' => now(config('studio.timezone'))->toDateString(), 'reference' => null, 'remarks' => $data['notes'] ?? null]],
            ]);
            $this->record($opportunity, $actor, 'created', null, $data['notes'] ?? null, $opportunity->getAttributes());

            return $opportunity;
        });
    }

    public function update(User $actor, int $id, array $input): Opportunity
    {
        return DB::transaction(function () use ($actor, $id, $input) {
            $opportunity = $this->locked($actor, $id);
            $this->requireActiveStage($opportunity);
            $this->checkAssignment($actor, $input, $opportunity->assigned_to);
            $data = Validator::make($input, $this->detailRules() + [
                'assigned_to' => ['sometimes', 'required', 'integer', Rule::exists('users', 'id')->where('active', true)],
                'invoice_id' => ['nullable', 'integer'],
            ])->validate();
            if (array_key_exists('invoice_id', $data)) {
                $data['invoice_id'] = $this->invoice($opportunity, $data['invoice_id'] ?? null)?->id;
            }
            $data['next_follow_up_at'] = $this->followUpTime($data['next_follow_up_at']);
            $before = $opportunity->only(array_keys($data));
            $opportunity->update($data);
            $this->record($opportunity, $actor, 'updated', $opportunity->stage, 'Enquiry details updated.', ['before' => $before, 'after' => $opportunity->only(array_keys($data))]);

            return $opportunity;
        }, 5);
    }

    public function transition(User $actor, int $id, array $input): Opportunity
    {
        return DB::transaction(function () use ($actor, $id, $input) {
            $opportunity = $this->locked($actor, $id);
            $this->requireActiveStage($opportunity);
            $data = Validator::make($input, [
                'stage' => ['required', Rule::in(Opportunity::STAGES)],
                'occurred_on' => ['required', 'date_format:Y-m-d', 'before_or_equal:'.now(config('studio.timezone'))->toDateString()],
                'reference' => ['nullable', 'string', 'max:160'],
                'remarks' => ['nullable', 'string', 'max:3000'],
                'reason' => ['nullable', 'string', 'max:3000'],
                'invoice_id' => ['nullable', 'integer'],
                'next_action' => ['nullable', 'string', 'max:500'],
                'next_follow_up_at' => ['nullable', 'date_format:Y-m-d\TH:i'],
            ])->validate();
            $stage = $data['stage'];
            if ($stage !== 'cancelled' && $stage !== $opportunity->nextStage()) {
                throw ValidationException::withMessages(['stage' => 'Move to the next stage in order. Reopening requires a separate manager action.']);
            }
            $previousDate = $opportunity->stage_details[$opportunity->stage]['occurred_on'] ?? null;
            if ($previousDate && $data['occurred_on'] < $previousDate) {
                throw ValidationException::withMessages(['occurred_on' => 'The stage date cannot be before the previous stage.']);
            }
            if (in_array($stage, ['proposal', 'order', 'payment', 'delivery'], true) && empty($data['reference'])) {
                throw ValidationException::withMessages(['reference' => 'Add the quotation, order, payment or delivery reference for this stage.']);
            }
            if ($stage === 'cancelled' && empty(trim($data['reason'] ?? ''))) {
                throw ValidationException::withMessages(['reason' => 'Explain why this enquiry is being cancelled.']);
            }
            $terminal = in_array($stage, ['closed', 'cancelled'], true);
            if (! $terminal && (empty(trim($data['next_action'] ?? '')) || empty($data['next_follow_up_at']))) {
                throw ValidationException::withMessages(['next_action' => 'Add the next action and follow-up date for an open enquiry.']);
            }
            if (! User::whereKey($opportunity->assigned_to)->where('active', true)->exists()) {
                throw ValidationException::withMessages(['assigned_to' => 'Assign an active team member before changing the stage.']);
            }
            $invoiceId = $data['invoice_id'] ?? $opportunity->invoice_id;
            $invoice = $this->invoice($opportunity, $invoiceId, $stage === 'closed');
            $from = $opportunity->stage;
            $details = [
                'occurred_on' => $data['occurred_on'],
                'reference' => $data['reference'] ?? null,
                'remarks' => $stage === 'cancelled' ? $data['reason'] : ($data['remarks'] ?? null),
            ];
            $opportunity->update([
                'stage' => $stage, 'stage_entered_at' => now(),
                'stage_details' => array_replace($opportunity->stage_details, [$stage => $details]),
                'invoice_id' => $invoice?->id,
                'cancellation_reason' => $stage === 'cancelled' ? $data['reason'] : null,
                'next_action' => $terminal ? null : $data['next_action'],
                'next_follow_up_at' => $terminal ? null : $this->followUpTime($data['next_follow_up_at']),
            ]);
            $this->record($opportunity, $actor, $stage === 'cancelled' ? 'cancelled' : 'transitioned', $from, $details['remarks'], $details + ['invoice_id' => $invoice?->id, 'invoice_number' => $invoice?->number, 'next_action' => $opportunity->next_action, 'next_follow_up_at' => $opportunity->next_follow_up_at?->toIso8601String()]);

            return $opportunity;
        }, 5);
    }

    public function reopen(User $actor, int $id, array $input): Opportunity
    {
        abort_unless($actor->isManager(), 403);
        $data = Validator::make($input, [
            'reason' => ['required', 'string', 'max:3000'],
            'assigned_to' => ['sometimes', 'required', 'integer', Rule::exists('users', 'id')->where('active', true)],
            'next_action' => ['required', 'string', 'max:500'],
            'next_follow_up_at' => ['required', 'date_format:Y-m-d\TH:i'],
        ])->validate();

        return DB::transaction(function () use ($actor, $id, $data) {
            $opportunity = $this->locked($actor, $id);
            if (! $opportunity->isTerminal()) {
                throw ValidationException::withMessages(['stage' => 'Only a closed or cancelled enquiry can be reopened.']);
            }
            $assignedTo = $data['assigned_to'] ?? $opportunity->assigned_to;
            if (! User::whereKey($assignedTo)->where('active', true)->exists()) {
                throw ValidationException::withMessages(['assigned_to' => 'The assigned team member must be active before reopening.']);
            }
            $from = $opportunity->stage;
            $previous = $opportunity->only(['stage_details', 'invoice_id', 'cancellation_reason', 'assigned_to']);
            $opportunity->update([
                'stage' => 'lead', 'stage_entered_at' => now(), 'invoice_id' => null, 'cancellation_reason' => null, 'assigned_to' => $assignedTo,
                'stage_details' => ['lead' => ['occurred_on' => now(config('studio.timezone'))->toDateString(), 'reference' => null, 'remarks' => $data['reason']]],
                'next_action' => $data['next_action'], 'next_follow_up_at' => $this->followUpTime($data['next_follow_up_at']),
            ]);
            $this->record($opportunity, $actor, 'reopened', $from, $data['reason'], ['previous_cycle' => $previous, 'assigned_to' => $assignedTo, 'next_action' => $data['next_action'], 'next_follow_up_at' => $opportunity->next_follow_up_at->toIso8601String()]);

            return $opportunity;
        }, 5);
    }

    public function attach(User $actor, int $id, array $input): OpportunityDocument
    {
        Opportunity::visibleTo($actor)->findOrFail($id);
        $data = Validator::make($input, [
            'document' => ['required', 'file', 'max:5120', 'mimetypes:application/pdf,image/jpeg,image/png,image/webp', 'extensions:pdf,jpg,jpeg,png,webp'],
            'label' => ['nullable', 'string', 'max:120'],
        ])->validate();
        /** @var UploadedFile $file */
        $file = $data['document'];
        $mime = $file->getMimeType();
        if ($mime !== 'application/pdf' && @getimagesize($file->getRealPath()) === false) {
            throw ValidationException::withMessages(['document' => 'Upload a valid PDF, JPEG, PNG or WebP file.']);
        }
        if ($mime === 'application/pdf') {
            $content = file_get_contents($file->getRealPath());
            if (! str_starts_with($content, '%PDF-') || ! str_contains(substr($content, -1024), '%%EOF')) {
                throw ValidationException::withMessages(['document' => 'Upload a complete PDF document.']);
            }
        }
        $path = $file->store('pipeline/'.$id, 'local');
        if (! $path) {
            throw ValidationException::withMessages(['document' => 'The document could not be stored. Try again.']);
        }
        try {
            return DB::transaction(function () use ($actor, $id, $data, $file, $mime, $path) {
                $opportunity = $this->locked($actor, $id);
                $name = mb_substr(preg_replace('/[\x00-\x1f\x7f]/u', '', basename(str_replace('\\', '/', $file->getClientOriginalName()))), 0, 180);
                $document = $opportunity->documents()->create([
                    'user_id' => $actor->id, 'label' => $data['label'] ?? 'Supporting document',
                    'original_name' => $name, 'path' => $path, 'mime_type' => $mime, 'size' => $file->getSize(),
                ]);
                $this->record($opportunity, $actor, 'document_added', $opportunity->stage, $document->label, ['document_id' => $document->id, 'file' => $name]);

                return $document;
            }, 5);
        } catch (Throwable $exception) {
            Storage::disk('local')->delete($path);
            throw $exception;
        }
    }

    private function locked(User $actor, int $id): Opportunity
    {
        $query = Opportunity::visibleTo($actor)->whereKey($id);
        abort_unless($query->exists(), 404);
        $query->update(['lock_version' => DB::raw('lock_version + 1')]);

        return Opportunity::visibleTo($actor)->lockForUpdate()->findOrFail($id);
    }

    private function requireActiveStage(Opportunity $opportunity): void
    {
        if ($opportunity->isTerminal()) {
            throw ValidationException::withMessages(['stage' => 'This enquiry is closed or cancelled. A manager must explicitly reopen it before changes.']);
        }
    }

    private function checkAssignment(User $actor, array $input, int $current): void
    {
        if (! $actor->isManager() && isset($input['assigned_to']) && (int) $input['assigned_to'] !== $current) {
            abort(403, 'Only managers can assign enquiries to other team members.');
        }
    }

    private function detailRules(): array
    {
        return [
            'title' => ['required', 'string', 'max:160'],
            'kind' => ['required', Rule::in(array_keys(Opportunity::KINDS))],
            'guest_count' => ['required', 'integer', 'between:1,500'],
            'event_date' => ['nullable', 'date_format:Y-m-d'],
            'notes' => ['nullable', 'string', 'max:5000'],
            'next_action' => ['required', 'string', 'max:500'],
            'next_follow_up_at' => ['required', 'date_format:Y-m-d\TH:i'],
        ];
    }

    private function invoice(Opportunity $opportunity, ?int $id, bool $requirePaid = false): ?Invoice
    {
        $invoice = $id ? Invoice::where('client_id', $opportunity->client_id)->lockForUpdate()->find($id) : null;
        if (($id && ! $invoice) || ($requirePaid && (! $invoice || $invoice->status !== 'paid'))) {
            throw ValidationException::withMessages(['invoice_id' => $requirePaid ? 'Link a paid invoice belonging to this client before closing.' : 'The linked invoice must belong to this client.']);
        }

        return $invoice;
    }

    private function followUpTime(string $value): CarbonImmutable
    {
        return CarbonImmutable::createFromFormat('Y-m-d\TH:i', $value, config('studio.timezone'))->startOfMinute()->utc();
    }

    private function record(Opportunity $opportunity, User $actor, string $type, ?string $from, ?string $remarks, array $details): void
    {
        $opportunity->events()->create([
            'user_id' => $actor->id, 'type' => $type, 'from_stage' => $from, 'to_stage' => $opportunity->stage,
            'remarks' => $remarks, 'details' => $details, 'created_at' => now(),
        ]);
    }
}
