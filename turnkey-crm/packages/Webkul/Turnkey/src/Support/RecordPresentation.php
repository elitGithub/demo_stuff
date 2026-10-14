<?php

namespace Webkul\Turnkey\Support;

use Carbon\Carbon;

/** Plain display values for the lists; no repositories or database connections. */
final class RecordPresentation
{
    public static function make(string $screen, object $row): array
    {
        $text = fn ($value) => self::text($value);
        $cell = fn ($value, $kind = 'text', $tone = null) => ['text' => $text($value), 'kind' => $kind, 'tone' => $tone, 'secondary' => null];
        $detail = fn ($label, $value) => ['label' => trans('turnkey::app.records.'.$label), 'value' => $text($value)];
        $created = self::date($row->created_at ?? null, true);

        if ($screen === 'persons') {
            $emails = self::values($row->emails ?? null);
            $phones = self::values($row->contact_numbers ?? null);
            $cells = [
                'organization' => $cell($row->organization ?? null),
                'emails' => $cell($emails[0] ?? null),
                'contact_numbers' => $cell($phones[0] ?? null),
                'tag_name' => $cell($row->tag_name ?? null, 'badge', 'neutral'),
            ];
            foreach (['emails' => $emails, 'contact_numbers' => $phones] as $key => $values) {
                $cells[$key]['secondary'] = count($values) > 1 ? trans('turnkey::app.records.more', ['count' => count($values) - 1]) : null;
            }

            return ['title' => $text($row->person_name ?? null), 'subtitle' => null, 'cells' => $cells,
                'details' => [$detail('all_emails', implode("\n", $emails)), $detail('all_phones', implode("\n", $phones)), $detail('reference', '#'.$row->id)]];
        }

        if ($screen === 'organizations') {
            $address = is_string($row->address ?? null) ? json_decode($row->address, true) : ($row->address ?? []);
            $address = is_array($address) ? $address : [];
            $street = $address['address'] ?? [];
            $street = is_array($street) ? implode(', ', array_filter($street, 'is_scalar')) : $street;
            $location = implode(', ', array_filter([$address['city'] ?? null, $address['country'] ?? null], 'is_scalar'));
            $fullAddress = implode("\n", array_filter([$street, $address['city'] ?? null, $address['state'] ?? null, $address['postcode'] ?? null, $address['country'] ?? null], 'is_scalar'));

            return ['title' => $text($row->name ?? null), 'subtitle' => null, 'cells' => [
                'location' => $cell($location), 'persons_count' => $cell($row->persons_count ?? 0, 'number'),
            ], 'details' => [$detail('address', $fullAddress), $detail('created', $created), $detail('reference', '#'.$row->id)]];
        }

        if ($screen === 'leads') {
            $tone = match ($row->stage_code ?? '') {
                'won' => 'blue', 'lost' => 'neutral', 'negotiation' => 'amber', default => 'blue'
            };

            return ['title' => $text($row->title ?? null), 'subtitle' => ! empty($row->lead_source_name) ? $text($row->lead_source_name) : null, 'cells' => [
                'person_name' => $cell($row->person_name ?? null), 'lead_value' => $cell(core()->formatBasePrice($row->lead_value ?? 0), 'money'),
                'stage' => $cell($row->stage ?? null, 'badge', $tone), 'sales_person' => $cell($row->sales_person ?? null, 'owner'),
                'expected_close_date' => $cell(self::date($row->expected_close_date ?? null)),
            ], 'details' => [$detail('source', $row->lead_source_name ?? null), $detail('type', $row->lead_type_name ?? null),
                $detail('tag', $row->tag_name ?? null), $detail('created', $created), $detail('reference', '#'.$row->id)]];
        }

        $expiry = $row->expired_at ?? null;
        $expired = $expiry && Carbon::parse($expiry)->endOfDay()->isPast();
        $validity = ! $expiry ? 'no_expiry' : ($expired ? 'expired' : 'active');

        return ['title' => $text($row->subject ?? null), 'subtitle' => trans('turnkey::app.records.quote_number', ['id' => $row->id]), 'cells' => [
            'person_name' => $cell($row->person_name ?? null), 'grand_total' => $cell(core()->formatBasePrice($row->grand_total ?? 0), 'money'),
            'expired_at' => $cell(self::date($expiry)), 'sales_person' => $cell($row->sales_person ?? null, 'owner'),
            'validity' => $cell(trans('turnkey::app.records.'.$validity), 'badge', ! $expiry ? 'neutral' : ($expired ? 'amber' : 'blue')),
        ], 'details' => [
            $detail('subtotal', core()->formatBasePrice($row->sub_total ?? 0)), $detail('discount', core()->formatBasePrice($row->discount_amount ?? 0)),
            $detail('tax', core()->formatBasePrice($row->tax_amount ?? 0)), $detail('adjustment', core()->formatBasePrice($row->adjustment_amount ?? 0)),
            $detail('created', $created), $detail('reference', '#'.$row->id),
        ]];
    }

    private static function text(mixed $value): string
    {
        return is_scalar($value) && trim((string) $value) !== '' ? strip_tags((string) $value) : '—';
    }

    private static function date(?string $value, bool $time = false): ?string
    {
        return $value ? Carbon::parse($value)->format($time ? 'M j, Y · g:i A' : 'M j, Y') : null;
    }

    private static function values(mixed $value): array
    {
        $items = is_string($value) ? json_decode($value, true) : $value;
        if (! is_array($items)) {
            return [];
        }

        return array_values(array_filter(array_map(fn ($item) => is_array($item) && is_scalar($item['value'] ?? null) ? trim(strip_tags((string) $item['value'])) : '', $items)));
    }
}
