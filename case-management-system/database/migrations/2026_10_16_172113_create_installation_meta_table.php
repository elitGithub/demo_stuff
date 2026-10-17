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
        Schema::create('installation_meta', function (Blueprint $table) {
            $table->id();
            $table->string('schema_version', 64);
            $table->dateTime('seeded_at');
            $table->dateTime('dates_shifted_to')->nullable();
            $table->string('mailbox_cursor', 64)->nullable();
        });
    }

    /**
     * @return void
     */
    public function down(): void
    {
        Schema::dropIfExists('installation_meta');
    }
};
