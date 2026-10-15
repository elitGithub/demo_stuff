<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('opportunities', function (Blueprint $table) {
            $table->id();
            $table->string('reference')->unique();
            $table->foreignId('client_id')->constrained()->restrictOnDelete();
            $table->foreignId('assigned_to')->constrained('users')->restrictOnDelete();
            $table->foreignId('created_by')->constrained('users')->restrictOnDelete();
            $table->foreignId('invoice_id')->nullable()->constrained()->restrictOnDelete();
            $table->string('title', 160);
            $table->string('kind', 30)->default('enquiry');
            $table->unsignedSmallInteger('guest_count')->default(1);
            $table->date('event_date')->nullable();
            $table->text('notes')->nullable();
            $table->string('stage', 20)->default('lead')->index();
            $table->dateTime('stage_entered_at');
            $table->json('stage_details');
            $table->string('next_action', 500)->nullable();
            $table->dateTime('next_follow_up_at')->nullable()->index();
            $table->text('cancellation_reason')->nullable();
            $table->unsignedInteger('lock_version')->default(0);
            $table->timestamps();
            $table->index(['assigned_to', 'stage']);
        });
        Schema::create('opportunity_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('opportunity_id')->constrained()->restrictOnDelete();
            $table->foreignId('user_id')->constrained()->restrictOnDelete();
            $table->string('type', 30);
            $table->string('from_stage', 20)->nullable();
            $table->string('to_stage', 20);
            $table->text('remarks')->nullable();
            $table->json('details');
            $table->dateTime('created_at');
            $table->index(['opportunity_id', 'id']);
        });
        Schema::create('opportunity_documents', function (Blueprint $table) {
            $table->id();
            $table->foreignId('opportunity_id')->constrained()->restrictOnDelete();
            $table->foreignId('user_id')->constrained()->restrictOnDelete();
            $table->string('label', 120);
            $table->string('original_name');
            $table->string('path')->unique();
            $table->string('mime_type', 80);
            $table->unsignedInteger('size');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('opportunity_documents');
        Schema::dropIfExists('opportunity_events');
        Schema::dropIfExists('opportunities');
    }
};
