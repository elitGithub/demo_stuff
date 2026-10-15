<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('subscribers', function (Blueprint $table) {
            $table->id();
            $table->string('email', 200)->unique();
            $table->string('unsubscribe_token', 64)->unique();
            $table->dateTime('consented_at');
            $table->dateTime('unsubscribed_at')->nullable();
            $table->timestamps();
        });
        Schema::create('marketing_messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('client_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('subscriber_id')->nullable()->constrained()->nullOnDelete();
            $table->string('kind', 30);
            $table->string('channel', 20);
            $table->string('recipient');
            $table->string('subject', 160);
            $table->text('body');
            $table->date('due_date')->index();
            $table->string('dedupe_key', 160)->unique();
            $table->uuid('campaign_key')->nullable()->index();
            $table->string('status', 20)->default('pending');
            $table->dateTime('processed_at')->nullable();
            $table->unsignedInteger('attempts')->default(0);
            $table->timestamps();
        });
        Schema::create('studio_settings', function (Blueprint $table) {
            $table->id();
            $table->string('key', 60)->unique();
            $table->text('value');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('studio_settings');
        Schema::dropIfExists('marketing_messages');
        Schema::dropIfExists('subscribers');
    }
};
