<?php

namespace Webkul\Turnkey\Database\Seeders;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use LogicException;
use Webkul\Activity\Repositories\ActivityRepository;
use Webkul\Contact\Repositories\OrganizationRepository;
use Webkul\Contact\Repositories\PersonRepository;
use Webkul\Core\Repositories\CoreConfigRepository;
use Webkul\Lead\Repositories\LeadRepository;
use Webkul\Lead\Repositories\PipelineRepository;
use Webkul\Lead\Repositories\SourceRepository;
use Webkul\Lead\Repositories\StageRepository;
use Webkul\Lead\Repositories\TypeRepository;
use Webkul\Product\Repositories\ProductRepository;
use Webkul\Quote\Repositories\QuoteRepository;
use Webkul\Turnkey\Support\DemoAccess;
use Webkul\Turnkey\Support\DemoDataset;
use Webkul\Turnkey\Support\DemoGuard;
use Webkul\User\Repositories\RoleRepository;
use Webkul\User\Repositories\UserRepository;

class DemoSeeder extends Seeder
{
    public function run(): void
    {
        $connection = config('database.default');
        $database = (string) config('database.connections.'.$connection.'.database');
        DemoGuard::assertCanSeed((bool) config('turnkey.demo'), $database, false, false);

        if (! Schema::hasTable('core_config') || ! Schema::hasTable('leads')) {
            throw new LogicException('Initialize the dedicated demo database with the Krayin installer first.');
        }

        DB::transaction(function () use ($database) {
            // Lock the initialized owner row so simultaneous preparations serialize.
            $owner = DB::table('users')->orderBy('id')->lockForUpdate()->first();
            if (! $owner || Hash::check('admin123', $owner->password)) {
                throw new LogicException('Create a private owner with a non-default password in the initial installer first.');
            }

            $hasBusinessData = false;
            foreach (['organizations', 'persons', 'leads', 'activities', 'products', 'quotes'] as $table) {
                $hasBusinessData = $hasBusinessData || DB::table($table)->exists();
            }
            DemoGuard::assertCanSeed(true, $database, DB::table('core_config')->where('code', 'turnkey.demo.seeded')->exists(), $hasBusinessData);

            if (DB::table('users')->whereIn('email', [config('turnkey.demo_email'), 'sales@turnkey.example'])->exists()) {
                throw new LogicException('The shared demo email addresses already exist. No records were changed.');
            }

            Model::withoutEvents(fn () => $this->populate());

            app(CoreConfigRepository::class)->updateOrCreate(['code' => 'turnkey.demo.seeded'], ['value' => now()->toIso8601String()]);
        });
    }

    private function populate(): void
    {
        $data = DemoDataset::build(now()->toDateTimeImmutable());
        $users = $this->createUsers();
        $pipeline = app(PipelineRepository::class)->findOneWhere(['is_default' => 1]);
        if (! $pipeline) {
            throw new LogicException('The default pipeline is missing. Complete the initial installation first.');
        }
        $stages = app(StageRepository::class)->findWhere(['lead_pipeline_id' => $pipeline->id])->keyBy('code');
        foreach (['new', 'follow-up', 'prospect', 'negotiation', 'won', 'lost'] as $code) {
            if (! isset($stages[$code])) {
                throw new LogicException('The initial pipeline is missing stage '.$code.'.');
            }
        }
        $source = app(SourceRepository::class)->first();
        $type = app(TypeRepository::class)->first();
        $companies = $contacts = $services = $leads = [];
        foreach ($data['companies'] as $i => $name) {
            $companies[] = app(OrganizationRepository::class)->create(['entity_type' => 'organizations', 'name' => $name, 'user_id' => $users[$i % 2]->id, 'address' => ['address' => (10 + $i).' Example Street', 'city' => 'Sampleton', 'state' => '', 'postcode' => '00000', 'country' => 'US']]);
        }
        foreach ($data['contacts'] as $i => $person) {
            $contacts[] = app(PersonRepository::class)->create(DemoDataset::personAttributes($person, $companies[$person['company']]->id, $users[$i % 2]->id));
        }
        foreach ($data['services'] as $service) {
            $services[] = app(ProductRepository::class)->create($service + ['entity_type' => 'products', 'description' => 'A sample service from Turnkey Services.', 'quantity' => 0]);
        }
        foreach ($data['leads'] as $i => $deal) {
            $lead = app(LeadRepository::class)->create(['entity_type' => 'leads', 'title' => $deal['title'], 'description' => 'Understand the customer needs, agree the scope and confirm the next step.', 'lead_value' => $deal['value'], 'status' => $deal['stage'] !== 'lost', 'user_id' => $users[$deal['owner']]->id, 'person_id' => $contacts[$deal['contact']]->id, 'lead_pipeline_id' => $pipeline->id, 'lead_pipeline_stage_id' => $stages[$deal['stage']]->id, 'lead_source_id' => $source?->id, 'lead_type_id' => $type?->id, 'expected_close_date' => $deal['expected_close_date'], 'closed_at' => $deal['closed_at'], 'lost_reason' => $deal['stage'] === 'lost' ? 'Customer postponed the project.' : null]);
            $lead->created_at = $deal['created_at'];
            $lead->save();
            $leads[] = $lead;
        }
        foreach ($data['activities'] as $item) {
            $lead = $leads[$item['lead']];
            $activity = app(ActivityRepository::class)->create(['title' => $item['title'], 'type' => $item['type'], 'comment' => $item['comment'], 'schedule_from' => $item['schedule_from'], 'schedule_to' => $item['schedule_to'], 'is_done' => $item['is_done'], 'user_id' => $lead->user_id, 'participants' => ['users' => [$lead->user_id], 'persons' => [$lead->person_id]]]);
            $activity->leads()->attach($lead->id);
            $activity->persons()->attach($lead->person_id);
        }
        foreach ($data['quotes'] as $item) {
            $lead = $leads[$item['lead']];
            $service = $services[$item['service']];
            $total = $data['services'][$item['service']]['price'] * $item['quantity'];
            $quote = app(QuoteRepository::class)->create(['entity_type' => 'quotes', 'subject' => $item['subject'], 'description' => 'Scope review, delivery and handover. This is a fictional demonstration proposal.', 'person_id' => $lead->person_id, 'user_id' => $lead->user_id, 'sub_total' => $total, 'grand_total' => $total, 'discount_percent' => 0, 'discount_amount' => 0, 'tax_amount' => 0, 'adjustment_amount' => 0, 'expired_at' => $item['expired_at'], 'items' => [['product_id' => $service->id, 'sku' => $service->sku, 'name' => $service->name, 'quantity' => $item['quantity'], 'price' => $service->price, 'total' => $total]]]);
            $quote->leads()->attach($lead->id);
        }
        foreach (['general.settings.menu_color.brand_color' => '#2563eb', 'general.settings.footer.show' => '0', 'general.settings.footer.label' => 'Turnkey CRM', 'general.settings.menu.leads' => 'Opportunities', 'general.settings.menu.products' => 'Services', 'general.magic_ai.settings.enable' => '0'] as $code => $value) {
            app(CoreConfigRepository::class)->updateOrCreate(['code' => $code], ['value' => $value]);
        }
    }

    private function createUsers(): array
    {
        $permissions = DemoAccess::permissions(config('acl', []));
        $role = app(RoleRepository::class)->create(['name' => 'Demo team', 'description' => 'CRM workflow access without system administration.', 'permission_type' => 'custom', 'permissions' => $permissions]);
        $users = [];
        foreach ([['Casey Morgan', config('turnkey.demo_email'), 'global'], ['Avery Taylor', 'sales@turnkey.example', 'individual']] as [$name, $email, $visibility]) {
            $users[] = app(UserRepository::class)->create(['name' => $name, 'email' => $email, 'password' => Hash::make(config('turnkey.demo_password')), 'role_id' => $role->id, 'status' => 1, 'view_permission' => $visibility]);
        }

        return $users;
    }
}
