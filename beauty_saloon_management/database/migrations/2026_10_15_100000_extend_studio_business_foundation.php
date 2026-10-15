<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('role')->default('staff');
            $table->boolean('active')->default(true);
            $table->foreignId('manager_id')->nullable()->constrained('users')->nullOnDelete();
        });
        DB::table('users')->update(['role' => 'manager']);
        if (config('studio.demo')) {
            DB::table('users')->where('email', config('studio.demo_email'))->update(['role' => 'owner']);
        }
        Schema::table('clients', function (Blueprint $table) {
            $table->date('birthday')->nullable();
            $table->date('anniversary')->nullable();
            $table->json('marketing_channels')->nullable();
            $table->string('segment')->default('b2c');
            $table->string('company')->nullable();
        });
        Schema::table('stylists', fn (Blueprint $table) => $table->unsignedTinyInteger('commission_rate')->default(0));
        if (config('studio.demo')) {
            foreach (['#496853' => '#555453', '#a77b56' => '#8b8077', '#687d92' => '#777d83', '#a47587' => '#9b9296'] as $old => $new) {
                DB::table('stylists')->where('color', $old)->update(['color' => $new]);
            }
        }
        Schema::table('invoices', function (Blueprint $table) {
            $table->unsignedBigInteger('appointment_id')->nullable()->change();
            $table->string('kind')->default('service');
            $table->string('idempotency_key')->nullable()->unique();
            $table->foreignId('stylist_id')->nullable()->constrained()->nullOnDelete();
            $table->string('stylist_name')->nullable();
            $table->unsignedTinyInteger('commission_rate')->default(0);
            $table->unsignedInteger('commission_amount')->default(0);
        });
    }

    public function down(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            $table->dropConstrainedForeignId('stylist_id');
            $table->dropUnique(['idempotency_key']);
            $table->dropColumn(['kind', 'idempotency_key', 'stylist_name', 'commission_rate', 'commission_amount']);
        });
        Schema::table('stylists', fn (Blueprint $table) => $table->dropColumn('commission_rate'));
        Schema::table('clients', fn (Blueprint $table) => $table->dropColumn(['birthday', 'anniversary', 'marketing_channels', 'segment', 'company']));
        Schema::table('users', function (Blueprint $table) {
            $table->dropConstrainedForeignId('manager_id');
            $table->dropColumn(['role', 'active']);
        });
    }
};
