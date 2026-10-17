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
        Schema::create('attachments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('case_message_id')->constrained('case_messages')->cascadeOnDelete();
            $table->string('filename', 255);
            $table->string('mime_type', 120);
            $table->unsignedInteger('size_bytes');
            $table->string('storage_path', 255);
            $table->timestamps();
        });
    }

    /**
     * @return void
     */
    public function down(): void
    {
        Schema::dropIfExists('attachments');
    }
};
