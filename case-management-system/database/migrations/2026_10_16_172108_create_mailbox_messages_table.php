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
        Schema::create('mailbox_messages', function (Blueprint $table) {
            $table->id();
            $table->string('gmail_message_id', 64)->unique();
            $table->string('thread_id', 64)->index();
            $table->string('label', 10);
            $table->string('from_email', 254);
            $table->string('from_name', 120)->nullable();
            $table->string('to_email', 254);
            $table->string('subject', 998);
            $table->longText('body_text');
            $table->string('snippet', 160);
            $table->boolean('is_notification')->default(false);
            $table->dateTime('received_at');
            $table->timestamps();
        });

        Schema::table('case_messages', function (Blueprint $table) {
            $table->foreign('mailbox_message_id')->references('id')->on('mailbox_messages')->nullOnDelete();
        });
    }

    /**
     * @return void
     */
    public function down(): void
    {
        Schema::table('case_messages', function (Blueprint $table) {
            $table->dropForeign(['mailbox_message_id']);
        });

        Schema::dropIfExists('mailbox_messages');
    }
};
