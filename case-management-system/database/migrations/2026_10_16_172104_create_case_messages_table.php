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
        Schema::create('case_messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('case_id')->constrained('cases')->cascadeOnDelete();
            $table->unsignedBigInteger('mailbox_message_id')->nullable()->unique();
            $table->string('gmail_message_id', 64)->unique();
            $table->string('thread_id', 64)->index();
            $table->string('direction', 10);
            $table->string('from_email', 254);
            $table->string('from_name', 120)->nullable();
            $table->string('to_email', 254);
            $table->string('subject', 998);
            $table->longText('body_text');
            $table->dateTime('sent_at');
            $table->timestamps();
        });
    }

    /**
     * @return void
     */
    public function down(): void
    {
        Schema::dropIfExists('case_messages');
    }
};
