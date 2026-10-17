<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->string('role')->default('customer')->index();
            $table->string('phone', 30)->nullable();
            $table->string('demo_key')->nullable()->unique();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->dropUnique(['demo_key']);
            $table->dropIndex(['role']);
            $table->dropColumn(['role', 'phone', 'demo_key']);
        });
    }
};
