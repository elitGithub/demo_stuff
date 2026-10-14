<?php

namespace Tests\Support;

use Illuminate\Foundation\Application;
use Mockery;
use Webkul\Admin\DataGrids\Contact\OrganizationDataGrid;
use Webkul\Admin\DataGrids\Contact\PersonDataGrid;
use Webkul\Admin\DataGrids\Lead\LeadDataGrid;
use Webkul\Admin\DataGrids\Quote\QuoteDataGrid;
use Webkul\Contact\Repositories\OrganizationRepository;
use Webkul\Contact\Repositories\PersonRepository;
use Webkul\Lead\Repositories\PipelineRepository;
use Webkul\Lead\Repositories\SourceRepository;
use Webkul\Lead\Repositories\StageRepository;
use Webkul\Lead\Repositories\TypeRepository;
use Webkul\Tag\Repositories\TagRepository;
use Webkul\User\Repositories\UserRepository;

/** Real providers and formatters with repository doubles, never a database service. */
final class RecordListSandbox
{
    public static function create(bool $demo = true): Application
    {
        $app = TurnkeyViewSandbox::create($demo);
        require_once $app->basePath('packages/Webkul/Admin/src/Http/helpers.php');
        $app['config']->set('app.currency', 'USD');
        $app->instance('bouncer', new class
        {
            public function hasPermission($permission): bool
            {
                return ! in_array($permission, config('test.denied_permissions', []));
            }
        });
        $pipeline = (object) ['id' => 1, 'name' => 'Service business', 'stages' => collect([
            (object) ['id' => 1, 'name' => 'New'], (object) ['id' => 2, 'name' => 'Follow Up'],
            (object) ['id' => 3, 'name' => 'Proposal'], (object) ['id' => 4, 'name' => 'Won'],
        ])];
        foreach ([OrganizationRepository::class, PersonRepository::class, PipelineRepository::class, SourceRepository::class,
            StageRepository::class, TypeRepository::class, UserRepository::class, TagRepository::class] as $class) {
            $repository = Mockery::mock($class);
            $repository->shouldReceive('all')->andReturn($class === PipelineRepository::class ? collect([$pipeline]) : collect());
            if ($class === PipelineRepository::class) {
                $repository->shouldReceive('getDefaultPipeline', 'find')->andReturn($pipeline);
            }
            if ($class === PersonRepository::class) {
                $repository->shouldReceive('findWhere')->andReturn(collect([1, 2]));
            }
            $app->instance($class, $repository);
        }

        foreach (['contacts.persons', 'contacts.organizations', 'leads', 'quotes'] as $route) {
            $path = 'admin/'.str_replace('.', '/', $route);
            foreach (['index' => '', 'create' => '/create', 'view' => '/view/{id}', 'edit' => '/edit/{id}', 'print' => '/print/{id}',
                'delete' => '/{id}', 'mass_delete' => '/mass-delete', 'mass_update' => '/mass-update'] as $action => $suffix) {
                $app['router']->get($path.$suffix, fn () => null)->name('admin.'.$route.'.'.$action);
            }
        }
        foreach (['saved_filters.index' => 'saved-filters', 'saved_filters.store' => 'saved-filters/store',
            'saved_filters.update' => 'saved-filters/{id}/update', 'saved_filters.destroy' => 'saved-filters/{id}/delete',
            'look_up' => 'datagrid/lookup'] as $name => $path) {
            $app['router']->get('admin/'.$path, fn () => null)->name('admin.datagrid.'.$name);
        }
        foreach (['get' => 'get', 'stage.update' => 'stage/{id}', 'kanban.look_up' => 'lookup', 'quotes.mail' => 'quotes/mail/{quote_id}'] as $name => $path) {
            $app['router']->get('admin/leads/'.$path, fn () => null)->name('admin.leads.'.$name);
        }
        $app['router']->get('admin/contacts/persons/google-export', fn () => null)->name('admin.contacts.persons.google_export.store');
        $app['router']->post('admin/leads/create-by-ai', fn () => null)->name('admin.leads.create_by_ai');
        $app['router']->getRoutes()->refreshNameLookups();

        return $app;
    }

    public static function classes(): array
    {
        return [
            'persons' => PersonDataGrid::class,
            'organizations' => OrganizationDataGrid::class,
            'leads' => LeadDataGrid::class,
            'quotes' => QuoteDataGrid::class,
        ];
    }

    public static function row(string $screen): object
    {
        return (object) match ($screen) {
            'persons' => ['id' => 1, 'person_name' => 'Alex Morgan', 'emails' => '[{"value":"alex@customer.example"}]', 'contact_numbers' => null, 'organization' => 'Maple & Co', 'organization_id' => 1, 'tag_name' => null],
            'organizations' => ['id' => 1, 'name' => 'Maple & Co', 'address' => '{"city":"Bristol","country":"GB"}', 'created_at' => null],
            'leads' => ['id' => 1, 'title' => 'New branch launch', 'lead_source_name' => 'Referral', 'lead_type_name' => 'Service', 'sales_person' => 'Avery Taylor', 'person_id' => null, 'person_name' => null, 'lead_value' => 2400, 'stage' => 'Follow Up', 'stage_code' => 'follow-up', 'expected_close_date' => null, 'created_at' => null, 'tag_name' => null, 'rotten_lead' => 0],
            'quotes' => ['id' => 1, 'subject' => 'Website and enquiry setup', 'sales_person' => 'Casey Morgan', 'person_id' => null, 'person_name' => null, 'sub_total' => 1800, 'discount_amount' => 100, 'tax_amount' => 340, 'adjustment_amount' => 0, 'grand_total' => 2040, 'expired_at' => null, 'created_at' => null],
        };
    }
}
