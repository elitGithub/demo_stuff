<?php

namespace Webkul\Turnkey\Support;

use DateTimeImmutable;

final class DemoDataset
{
    public static function personAttributes(array $person, int $organizationId, int $userId): array
    {
        return [
            'entity_type' => 'persons',
            'name' => $person['name'],
            'emails' => [['value' => $person['email'], 'label' => 'work']],
            'job_title' => $person['job_title'],
            'organization_id' => $organizationId,
            'user_id' => $userId,
        ];
    }

    public static function build(DateTimeImmutable $today): array
    {
        $today = $today->setTime(9, 0);
        $date = fn (int $days) => $today->modify(sprintf('%+d days', $days))->format('Y-m-d H:i:s');
        $companies = ['Maple & Co', 'Harbour Studio', 'Cedar Property Care', 'Northstar Fitness', 'Bloom Events', 'Oakline Interiors', 'Brightside Learning', 'Summit Consulting'];
        $names = ['Alex Morgan', 'Jamie Rivera', 'Sam Bennett', 'Taylor Brooks', 'Casey Jordan', 'Morgan Ellis', 'Robin Patel', 'Drew Campbell', 'Jordan Lee', 'Avery Scott', 'Cameron Blake', 'Quinn Parker'];
        $contacts = [];
        foreach ($names as $i => $name) {
            $contacts[] = ['name' => $name, 'email' => strtolower(str_replace(' ', '.', $name)).'@customer.example', 'company' => $i % 8, 'job_title' => $i < 8 ? 'Business owner' : 'Operations manager'];
        }

        $services = [
            ['name' => 'Business process review', 'sku' => 'SERVICE-REVIEW', 'price' => 650],
            ['name' => 'Website and enquiry setup', 'sku' => 'SERVICE-WEB', 'price' => 1800],
            ['name' => 'Monthly service retainer', 'sku' => 'SERVICE-CARE', 'price' => 450],
            ['name' => 'Team onboarding workshop', 'sku' => 'SERVICE-TRAIN', 'price' => 900],
        ];
        $titles = ['New branch launch', 'Enquiry workflow refresh', 'Customer follow-up setup', 'Membership enquiry system', 'Event booking workflow', 'Consultation scheduling', 'New term onboarding', 'Client reporting setup', 'Quarterly process review', 'Website refresh', 'Ongoing service support', 'Team training package'];
        $stages = ['new', 'follow-up', 'prospect', 'negotiation', 'won', 'lost'];
        $leads = [];
        foreach ($titles as $i => $title) {
            $stage = $stages[$i % 6];
            $leads[] = ['title' => $title, 'contact' => $i, 'stage' => $stage, 'value' => [1800, 2400, 1350, 3600, 900, 650][$i % 6], 'owner' => $i % 2, 'created_at' => $date(-($i + 2)), 'expected_close_date' => $date(7 + $i), 'closed_at' => in_array($stage, ['won', 'lost'], true) ? $date(-1 - ($i % 3)) : null];
        }

        $actions = ['Follow up on the enquiry', 'Confirm the discovery call', 'Prepare the service proposal', 'Review the proposed scope', 'Send the onboarding checklist', 'Record the customer feedback', 'Confirm the next appointment', 'Check progress with the customer'];
        $activities = [];
        for ($i = 0; $i < 16; $i++) {
            $activities[] = ['title' => $actions[$i % 8], 'lead' => $i % 12, 'type' => ['call', 'meeting', 'task', 'note'][$i % 4], 'schedule_from' => $date(($i % 8) - 1), 'schedule_to' => $today->modify(sprintf('%+d days +1 hour', ($i % 8) - 1))->format('Y-m-d H:i:s'), 'is_done' => $i >= 12, 'comment' => 'Fictional demo activity. Agree the next action and keep the customer informed.'];
        }

        $quotes = [];
        foreach ([2, 3, 8, 9] as $i => $lead) {
            $quotes[] = ['subject' => $titles[$lead].' — service proposal', 'lead' => $lead, 'service' => $i, 'quantity' => $i === 2 ? 3 : 1, 'expired_at' => $date(14 + $i)];
        }

        return compact('companies', 'contacts', 'services', 'leads', 'activities', 'quotes');
    }
}
