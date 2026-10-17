<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('categories', function (Blueprint $table): void {
            $table->id();
            $table->string('name', 80);
            $table->string('slug')->unique();
            $table->string('description', 500);
            $table->string('icon', 40);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('provider_profiles', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('user_id')->unique()->constrained()->restrictOnDelete();
            $table->string('business_name', 120);
            $table->string('slug')->unique();
            $table->text('bio');
            $table->json('service_areas');
            $table->string('status')->default('pending')->index();
            $table->timestamps();
        });

        Schema::create('category_provider_profile', function (Blueprint $table): void {
            $table->foreignId('category_id')->constrained()->restrictOnDelete();
            $table->foreignId('provider_profile_id')->constrained()->cascadeOnDelete();
            $table->unique(['category_id', 'provider_profile_id']);
        });

        Schema::create('service_requests', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('customer_id')->constrained('users')->restrictOnDelete();
            $table->foreignId('category_id')->constrained()->restrictOnDelete();
            $table->string('title', 120);
            $table->text('description');
            $table->string('service_area', 80);
            $table->string('street_address', 255);
            $table->date('preferred_date');
            $table->unsignedInteger('budget_cents')->nullable();
            $table->string('status')->default('open')->index();
            $table->unsignedBigInteger('accepted_quote_id')->nullable()->unique();
            $table->timestamps();
            $table->index(['category_id', 'status', 'service_area']);
        });

        Schema::create('request_photos', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('service_request_id')->constrained()->restrictOnDelete();
            $table->string('path')->unique();
            $table->string('mime_type', 80);
            $table->string('original_name');
            $table->unsignedInteger('width');
            $table->unsignedInteger('height');
            $table->timestamps();
        });

        Schema::create('quotes', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('service_request_id')->constrained()->restrictOnDelete();
            $table->foreignId('provider_id')->constrained('users')->restrictOnDelete();
            $table->unsignedInteger('amount_cents');
            $table->date('available_date');
            $table->text('scope');
            $table->string('status')->default('pending')->index();
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
            $table->unique(['service_request_id', 'provider_id']);
        });

        Schema::table('service_requests', function (Blueprint $table): void {
            $table->foreign('accepted_quote_id')->references('id')->on('quotes')->restrictOnDelete();
        });

        Schema::create('messages', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('quote_id')->constrained()->restrictOnDelete();
            $table->foreignId('sender_id')->constrained('users')->restrictOnDelete();
            $table->text('body');
            $table->timestamps();
        });

        Schema::create('job_events', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('service_request_id')->constrained()->restrictOnDelete();
            $table->foreignId('actor_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->string('type', 80);
            $table->string('description', 500);
            $table->timestamps();
        });

        Schema::create('reviews', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('service_request_id')->unique()->constrained()->restrictOnDelete();
            $table->foreignId('customer_id')->constrained('users')->restrictOnDelete();
            $table->foreignId('provider_id')->constrained('users')->restrictOnDelete();
            $table->unsignedTinyInteger('rating');
            $table->text('body');
            $table->timestamps();
        });

        Schema::create('payments', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('service_request_id')->unique()->constrained()->restrictOnDelete();
            $table->foreignId('customer_id')->constrained('users')->restrictOnDelete();
            $table->uuid('receipt_number')->unique();
            $table->unsignedInteger('amount_cents');
            $table->string('currency', 3);
            $table->string('status')->default('simulated_paid');
            $table->timestamp('paid_at');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payments');
        Schema::dropIfExists('reviews');
        Schema::dropIfExists('job_events');
        Schema::dropIfExists('messages');
        Schema::table('service_requests', function (Blueprint $table): void {
            $table->dropForeign(['accepted_quote_id']);
        });
        Schema::dropIfExists('quotes');
        Schema::dropIfExists('request_photos');
        Schema::dropIfExists('service_requests');
        Schema::dropIfExists('category_provider_profile');
        Schema::dropIfExists('provider_profiles');
        Schema::dropIfExists('categories');
    }
};
