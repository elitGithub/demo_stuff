<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * @return void
     */
    public function up(): void
    {
        Schema::create('cases', function (Blueprint $table) {
            $table->id();
            $table->string('number', 16)->unique();
            $table->string('status', 20)->index();
            $table->text('issue')->nullable();
            $table->text('notes')->nullable();
            $table->foreignId('tracked_sender_id')->constrained('tracked_senders')->restrictOnDelete();
            $table->string('sender_email', 254);
            $table->string('sender_name', 120);
            $table->string('subject', 998);
            $table->string('thread_id', 64)->unique();
            $table->dateTime('received_at')->index();
            $table->dateTime('closed_at')->nullable();
            $table->timestamps();
        });
    }

    /**
     * @return void
     */
    public function down(): void
    {
        Schema::dropIfExists('cases');
    }
};
