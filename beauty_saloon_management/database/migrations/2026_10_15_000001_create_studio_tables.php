<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('stylists', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('title');
            $table->text('bio')->nullable();
            $table->string('color')->default('#555453');
            $table->json('working_days')->nullable();
            $table->string('start_time', 5)->default('09:00');
            $table->string('end_time', 5)->default('18:00');
            $table->boolean('active')->default(true);
            $table->unsignedInteger('lock_version')->default(0);
            $table->timestamps();
        });
        Schema::create('services', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('category');
            $table->text('description')->nullable();
            $table->unsignedInteger('price');
            $table->unsignedInteger('duration');
            $table->boolean('active')->default(true);
            $table->timestamps();
        });
        Schema::create('service_stylist', function (Blueprint $table) {
            $table->foreignId('service_id')->constrained()->cascadeOnDelete();
            $table->foreignId('stylist_id')->constrained()->cascadeOnDelete();
            $table->primary(['service_id', 'stylist_id']);
        });
        Schema::create('clients', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('email')->nullable()->index();
            $table->string('phone')->nullable();
            $table->string('style_name')->nullable();
            $table->text('style_notes')->nullable();
            $table->string('style_photo')->nullable();
            $table->json('preferred_services')->nullable();
            $table->foreignId('preferred_stylist_id')->nullable()->constrained('stylists')->nullOnDelete();
            $table->unsignedInteger('maintenance_weeks')->default(6);
            $table->json('channels')->nullable();
            $table->string('source')->default('studio');
            $table->timestamps();
        });
        Schema::create('appointments', function (Blueprint $table) {
            $table->id();
            $table->uuid('reference')->unique();
            $table->foreignId('client_id')->constrained()->restrictOnDelete();
            $table->foreignId('stylist_id')->constrained()->restrictOnDelete();
            $table->dateTime('starts_at');
            $table->dateTime('ends_at');
            $table->string('status')->default('booked');
            $table->unsignedInteger('total');
            $table->text('notes')->nullable();
            $table->timestamps();
            $table->index(['stylist_id', 'starts_at', 'ends_at']);
        });
        Schema::create('appointment_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('appointment_id')->constrained()->cascadeOnDelete();
            $table->foreignId('service_id')->constrained()->restrictOnDelete();
            $table->string('name');
            $table->unsignedInteger('price');
            $table->unsignedInteger('duration');
        });
        Schema::create('time_offs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('stylist_id')->constrained()->cascadeOnDelete();
            $table->dateTime('starts_at');
            $table->dateTime('ends_at');
            $table->string('reason')->nullable();
            $table->timestamps();
        });
        Schema::create('client_notes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('client_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->text('body');
            $table->timestamps();
        });
        Schema::create('follow_ups', function (Blueprint $table) {
            $table->id();
            $table->foreignId('client_id')->constrained()->cascadeOnDelete();
            $table->string('title');
            $table->date('due_date');
            $table->dateTime('completed_at')->nullable();
            $table->timestamps();
        });
        Schema::create('invoices', function (Blueprint $table) {
            $table->id();
            $table->foreignId('appointment_id')->unique()->constrained()->restrictOnDelete();
            $table->foreignId('client_id')->constrained()->restrictOnDelete();
            $table->string('number')->unique();
            $table->string('client_name');
            $table->string('client_email')->nullable();
            $table->string('currency', 3);
            $table->unsignedInteger('subtotal');
            $table->unsignedInteger('tax');
            $table->unsignedInteger('tax_percent');
            $table->unsignedInteger('total');
            $table->string('status')->default('unpaid');
            $table->dateTime('issued_at');
            $table->dateTime('paid_at')->nullable();
            $table->timestamps();
        });
        Schema::create('invoice_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('invoice_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->unsignedInteger('price');
            $table->unsignedInteger('quantity')->default(1);
        });
        Schema::create('payments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('invoice_id')->unique()->constrained()->restrictOnDelete();
            $table->string('reference')->unique();
            $table->string('method');
            $table->unsignedInteger('amount');
            $table->dateTime('recorded_at');
            $table->timestamps();
        });
        Schema::create('reminders', function (Blueprint $table) {
            $table->id();
            $table->foreignId('appointment_id')->constrained()->cascadeOnDelete();
            $table->string('channel');
            $table->string('recipient');
            $table->text('body');
            $table->dateTime('scheduled_at')->index();
            $table->dateTime('processed_at')->nullable();
            $table->string('status')->default('pending');
            $table->unsignedInteger('attempts')->default(0);
            $table->timestamps();
            $table->unique(['appointment_id', 'channel']);
        });
    }

    public function down(): void
    {
        foreach (['reminders', 'payments', 'invoice_items', 'invoices', 'follow_ups', 'client_notes', 'time_offs', 'appointment_items', 'appointments', 'clients', 'service_stylist', 'services', 'stylists'] as $table) {
            Schema::dropIfExists($table);
        }
    }
};
