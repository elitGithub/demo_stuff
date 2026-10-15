<?php

namespace Database\Seeders;

use App\Models\Client;
use App\Models\Opportunity;
use App\Models\User;
use App\Services\BillingService;
use App\Services\PipelineService;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class PipelineSeeder extends Seeder
{
    public function run(): void
    {
        if (! config('studio.demo')) {
            return;
        }
        $manager = User::where('active', true)->whereIn('role', ['owner', 'manager'])->orderBy('id')->first();
        if (! $manager) {
            return;
        }
        $agent = User::where('active', true)->where('role', 'staff')->orderBy('id')->first() ?? $manager;
        $pipeline = app(PipelineService::class);
        $examples = [
            ['lead', 'Bridal party consultation', 'Maya Hart', 'b2c', null, 'group_booking', 6, 'Call Maya to discuss the wedding morning'],
            ['engagement', 'Team celebration styling', 'Riley Quinn', 'b2b', 'Olive Design Studio', 'group_booking', 8, 'Confirm styling preferences with the organiser'],
            ['proposal', 'Graduation styling package', 'Ella Finch', 'b2c', null, 'package', 1, 'Follow up on the written quotation'],
            ['order', 'Community event grooming', 'Avery Lane', 'b2g', 'Fictional Olive Arts Council', 'group_booking', 10, 'Confirm the event guest list'],
            ['payment', 'Portrait day styling', 'Sam Ellis', 'b2b', 'Northlight Creative', 'group_booking', 4, 'Ask the manager to reconcile the bank transfer'],
            ['delivery', 'Occasion haircare package', 'Alex Reed', 'b2c', null, 'package', 1, 'Confirm receipt of the care kit'],
            ['closed', 'Bridal care kit package', 'Nora Vale', 'b2c', null, 'package', 1, 'Confirm the completed handover'],
            ['cancelled', 'Autumn party enquiry', 'Jamie Rowan', 'b2c', null, 'enquiry', 3, 'Confirm the original event date'],
        ];
        foreach ($examples as $index => [$target, $title, $name, $segment, $company, $kind, $guests, $action]) {
            $reference = 'ENQ-DEMO-'.str_pad((string) ($index + 1), 3, '0', STR_PAD_LEFT);
            if (Opportunity::where('reference', $reference)->exists()) {
                continue;
            }
            DB::transaction(function () use ($pipeline, $manager, $agent, $index, $target, $title, $name, $segment, $company, $kind, $guests, $action, $reference) {
                $client = Client::firstOrCreate(['email' => 'pipeline-demo-'.($index + 1).'@example.test'], ['name' => $name, 'segment' => $segment, 'company' => $company, 'phone' => '+155501020'.str_pad((string) $index, 2, '0', STR_PAD_LEFT)]);
                $followUp = now(config('studio.timezone'))->addDays($index % 3 - 1)->setTime(11, 0)->format('Y-m-d\TH:i');
                $opportunity = $pipeline->create($manager, [
                    'client_id' => $client->id, 'assigned_to' => $agent->id, 'title' => $title, 'kind' => $kind,
                    'guest_count' => $guests, 'event_date' => now()->addDays(10 + $index)->toDateString(),
                    'notes' => 'Fictional demonstration enquiry. Confirm services and appointment availability separately.',
                    'next_action' => $action, 'next_follow_up_at' => $followUp,
                ]);
                $opportunity->update(['reference' => $reference]);
                if ($target === 'lead') {
                    return;
                }
                if ($target === 'cancelled') {
                    $pipeline->transition($manager, $opportunity->id, ['stage' => 'cancelled', 'occurred_on' => now(config('studio.timezone'))->toDateString(), 'reason' => 'The organiser postponed the event. Reopen only after a new request.']);

                    return;
                }
                foreach (['engagement', 'proposal', 'order', 'payment', 'delivery', 'closed'] as $stage) {
                    $step = [
                        'stage' => $stage, 'occurred_on' => now(config('studio.timezone'))->toDateString(),
                        'reference' => strtoupper($stage).'-DEMO-'.($index + 1), 'remarks' => 'Fictional demonstration stage; no message or payment was sent.',
                        'next_action' => $action, 'next_follow_up_at' => $followUp,
                    ];
                    if ($stage === 'closed') {
                        $billing = app(BillingService::class);
                        $invoice = $billing->issueStandalone($client, [['name' => 'Bridal care kit (demo)', 'price' => 7900, 'quantity' => 1]], 'retail', 'pipeline-demo-closed-kit');
                        $billing->pay($invoice, 'cash');
                        $step['invoice_id'] = $invoice->id;
                    }
                    $pipeline->transition($manager, $opportunity->id, $step);
                    if ($stage === $target) {
                        break;
                    }
                }
            });
        }
    }
}
