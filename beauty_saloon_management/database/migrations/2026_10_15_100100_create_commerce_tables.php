<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('products', function (Blueprint $table) {
            $table->id();
            $table->string('sku', 60)->unique();
            $table->string('name', 120);
            $table->text('description')->nullable();
            $table->unsignedInteger('price');
            $table->unsignedInteger('stock')->default(0);
            $table->boolean('active')->default(true);
            $table->timestamps();
        });
        Schema::create('stock_movements', function (Blueprint $table) {
            $table->id();
            $table->foreignId('product_id')->constrained()->restrictOnDelete();
            $table->foreignId('invoice_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->integer('quantity');
            $table->unsignedInteger('balance');
            $table->string('reason', 255);
            $table->timestamps();
            $table->unique(['invoice_id', 'product_id']);
        });
        Schema::create('membership_plans', function (Blueprint $table) {
            $table->id();
            $table->string('name', 120)->unique();
            $table->text('benefits');
            $table->unsignedInteger('price');
            $table->unsignedInteger('duration_days');
            $table->boolean('active')->default(true);
            $table->timestamps();
        });
        Schema::create('memberships', function (Blueprint $table) {
            $table->id();
            $table->foreignId('client_id')->constrained()->restrictOnDelete();
            $table->foreignId('membership_plan_id')->constrained()->restrictOnDelete();
            $table->foreignId('invoice_id')->unique()->constrained()->restrictOnDelete();
            $table->foreignId('previous_membership_id')->nullable()->unique()->constrained('memberships')->restrictOnDelete();
            $table->string('idempotency_key', 100)->unique();
            $table->string('plan_name', 120);
            $table->text('benefits');
            $table->unsignedInteger('price');
            $table->unsignedInteger('duration_days');
            $table->date('starts_on');
            $table->date('ends_on');
            $table->timestamps();
            $table->index(['client_id', 'membership_plan_id', 'ends_on']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('memberships');
        Schema::dropIfExists('membership_plans');
        Schema::dropIfExists('stock_movements');
        Schema::dropIfExists('products');
    }
};
