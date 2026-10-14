<?php

namespace Webkul\Turnkey\Support;

final class DemoAccess
{
    public static function allows(string $route, bool $hasUploads): bool
    {
        if ($hasUploads || preg_match('/(?:mail|emails|create_by_ai|webhook)/', $route)) {
            return false;
        }

        if (in_array($route, [
            'krayin.home', 'admin.session.create', 'admin.session.store', 'admin.session.destroy',
            'admin.settings.users.search', 'admin.settings.tags.search',
            'admin.settings.attributes.lookup', 'admin.settings.attributes.lookup_entity',
            'admin.settings.attributes.check_unique_validation',
        ], true)) {
            return true;
        }

        foreach (['admin.dashboard.', 'admin.leads.', 'admin.contacts.', 'admin.activities.', 'admin.quotes.', 'admin.products.', 'admin.datagrid.'] as $prefix) {
            if (str_starts_with($route, $prefix)) {
                return true;
            }
        }

        return false;
    }

    public static function permissions(array $acl): array
    {
        $permissions = [];
        foreach ($acl as $item) {
            $root = explode('.', $item['key'])[0];
            if (in_array($root, ['dashboard', 'leads', 'contacts', 'activities', 'products', 'quotes'], true) && ! str_contains($item['key'], 'mail')) {
                $permissions[] = $item['key'];
            }
        }

        // Native Bouncer requires these read permissions for CRM lookup helpers.
        // The demo route policy still denies the settings pages and mutations.
        return array_merge($permissions, [
            'settings.user.users',
            'settings.automation.attributes',
            'settings.other_settings.tags',
        ]);
    }
}
