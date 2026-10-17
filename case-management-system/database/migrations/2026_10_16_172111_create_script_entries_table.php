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
        Schema::create('script_entries', function (Blueprint $table) {
            $table->id();
            $table->string('kind', 20);
            $table->unsignedInteger('position')->nullable()->unique();
            $table->string('thread_id', 64)->nullable();
            $table->json('payload');
            $table->dateTime('delivered_at')->nullable();
            $table->timestamps();
        });
    }

    /**
     * @return void
     */
    public function down(): void
    {
        Schema::dropIfExists('script_entries');
    }
};
