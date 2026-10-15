<?php

namespace App\Http\Controllers;

use App\Models\Client;
use App\Models\Opportunity;
use App\Models\User;
use App\Services\PipelineService;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\View\View;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;

class PipelineController extends Controller
{
    public function index(Request $request): View
    {
        $query = $this->filtered($request);
        $counts = (clone $query)->selectRaw('stage, count(*) as total')->groupBy('stage')->pluck('total', 'stage');
        $opportunities = $query->with(['client', 'assignedUser'])->orderByRaw('next_follow_up_at IS NULL')->orderBy('next_follow_up_at')->orderBy('id')->paginate(48)->withQueryString();

        return view('pipeline.index', compact('opportunities', 'counts') + ['stages' => Opportunity::STAGES, 'agents' => $this->agents($request)]);
    }

    public function create(Request $request): View
    {
        return view('pipeline.create', ['clients' => Client::orderBy('name')->get(['id', 'name', 'company', 'segment']), 'agents' => $this->agents($request), 'opportunity' => new Opportunity]);
    }

    public function store(Request $request, PipelineService $pipeline): RedirectResponse
    {
        $opportunity = $pipeline->create($request->user(), $request->all());

        return redirect()->route('pipeline.show', $opportunity)->with('success', 'Enquiry created and next follow-up scheduled.');
    }

    public function show(Request $request, int $opportunity): View
    {
        $opportunity = Opportunity::visibleTo($request->user())->with(['client', 'assignedUser', 'invoice', 'documents.user'])->findOrFail($opportunity);
        $events = $opportunity->events()->with('user')->latest('id')->paginate(20);
        $invoices = $opportunity->client->invoices()->latest('id')->get(['id', 'number', 'status']);

        return view('pipeline.show', compact('opportunity', 'events', 'invoices') + ['agents' => $this->agents($request)]);
    }

    public function update(Request $request, int $opportunity, PipelineService $pipeline): RedirectResponse
    {
        $opportunity = $pipeline->update($request->user(), $opportunity, $request->all());

        return redirect()->route('pipeline.show', $opportunity)->with('success', 'Enquiry details saved.');
    }

    public function transition(Request $request, int $opportunity, PipelineService $pipeline): RedirectResponse
    {
        $opportunity = $pipeline->transition($request->user(), $opportunity, $request->all());

        return redirect()->route('pipeline.show', $opportunity)->with('success', 'Stage updated and recorded in history.');
    }

    public function reopen(Request $request, int $opportunity, PipelineService $pipeline): RedirectResponse
    {
        $opportunity = $pipeline->reopen($request->user(), $opportunity, $request->all());

        return redirect()->route('pipeline.show', $opportunity)->with('success', 'Enquiry reopened as a new lead. Previous history is preserved.');
    }

    public function upload(Request $request, int $opportunity, PipelineService $pipeline): RedirectResponse
    {
        $pipeline->attach($request->user(), $opportunity, $request->all());

        return redirect()->route('pipeline.show', $opportunity)->with('success', 'Private document added.');
    }

    public function download(Request $request, int $opportunity, int $document): StreamedResponse
    {
        $opportunity = Opportunity::visibleTo($request->user())->findOrFail($opportunity);
        $document = $opportunity->documents()->findOrFail($document);
        abort_unless(Storage::disk('local')->exists($document->path), 404);

        return Storage::disk('local')->download($document->path, $document->original_name, [
            'Content-Type' => $document->mime_type, 'X-Content-Type-Options' => 'nosniff',
            'Content-Security-Policy' => "default-src 'none'; sandbox", 'Cache-Control' => 'private, no-store',
        ]);
    }

    public function export(Request $request): StreamedResponse
    {
        $query = $this->filtered($request)->with(['client', 'assignedUser', 'invoice'])->orderBy('id');

        return response()->streamDownload(function () use ($query) {
            $stream = fopen('php://output', 'w');
            $headers = ['Enquiry reference', 'Title', 'Client', 'Company', 'Segment', 'Kind', 'Guests', 'Event date', 'Stage', 'Assigned to', 'Stage entered', 'Next action', 'Next follow-up', 'Invoice', 'Cancellation reason', 'Notes'];
            foreach (Opportunity::STAGES as $stage) {
                array_push($headers, ucfirst($stage).' date', ucfirst($stage).' reference', ucfirst($stage).' remarks');
            }
            fputcsv($stream, $headers, ',', '"', '');
            foreach ($query->lazy(200) as $opportunity) {
                $row = [
                    $opportunity->reference, $opportunity->title, $opportunity->client->name, $opportunity->client->company,
                    $opportunity->client->segment, Opportunity::KINDS[$opportunity->kind], $opportunity->guest_count,
                    $opportunity->event_date?->format('Y-m-d'), $opportunity->stage, $opportunity->assignedUser->name,
                    $opportunity->stage_entered_at->setTimezone(config('studio.timezone'))->format('Y-m-d H:i'),
                    $opportunity->next_action, $opportunity->next_follow_up_at?->setTimezone(config('studio.timezone'))->format('Y-m-d H:i'),
                    $opportunity->invoice?->number, $opportunity->cancellation_reason, $opportunity->notes,
                ];
                foreach (Opportunity::STAGES as $stage) {
                    $detail = $opportunity->stage_details[$stage] ?? [];
                    array_push($row, $detail['occurred_on'] ?? '', $detail['reference'] ?? '', $detail['remarks'] ?? '');
                }
                fputcsv($stream, array_map(fn ($value) => $this->csvCell($value), $row), ',', '"', '');
            }
            fclose($stream);
        }, 'studio-enquiries-'.now()->format('Y-m-d').'.csv', ['Content-Type' => 'text/csv; charset=UTF-8', 'Cache-Control' => 'private, no-store']);
    }

    private function filtered(Request $request): Builder
    {
        $data = $request->validate([
            'q' => ['nullable', 'string', 'max:120'],
            'stage' => ['nullable', Rule::in(Opportunity::STAGES)],
            'segment' => ['nullable', Rule::in(['b2c', 'b2b', 'b2g'])],
            'assigned_to' => ['nullable', 'integer'],
            'due' => ['nullable', Rule::in(['1'])],
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:from'],
        ]);
        $query = Opportunity::visibleTo($request->user());
        if (! empty($data['q'])) {
            $query->where(function (Builder $query) use ($data) {
                $query->where('title', 'like', '%'.$data['q'].'%')->orWhere('reference', 'like', '%'.$data['q'].'%')
                    ->orWhereHas('client', fn (Builder $clients) => $clients->where('name', 'like', '%'.$data['q'].'%')->orWhere('company', 'like', '%'.$data['q'].'%'));
            });
        }
        foreach (['stage', 'assigned_to'] as $field) {
            if (! empty($data[$field])) {
                $query->where($field, $data[$field]);
            }
        }
        if (! empty($data['segment'])) {
            $query->whereHas('client', fn (Builder $clients) => $clients->where('segment', $data['segment']));
        }
        if (! empty($data['due'])) {
            $query->where('next_follow_up_at', '<=', now())->whereNotIn('stage', ['closed', 'cancelled']);
        }
        if (! empty($data['from'])) {
            $query->where('stage_entered_at', '>=', CarbonImmutable::parse($data['from'], config('studio.timezone'))->startOfDay()->utc());
        }
        if (! empty($data['to'])) {
            $query->where('stage_entered_at', '<', CarbonImmutable::parse($data['to'], config('studio.timezone'))->addDay()->startOfDay()->utc());
        }

        return $query;
    }

    private function agents(Request $request): Collection
    {
        return $request->user()->isManager() ? User::where('active', true)->orderBy('name')->get(['id', 'name']) : new Collection;
    }

    private function csvCell(mixed $value): string
    {
        $value = (string) ($value ?? '');

        return preg_match('/^[\s\x00-\x1f]*[=+@-]|^[\t\r\n]/u', $value) ? "'".$value : $value;
    }
}
