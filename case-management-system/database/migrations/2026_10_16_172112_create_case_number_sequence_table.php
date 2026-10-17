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
        Schema::create('case_number_sequence', function (Blueprint $table) {
            $table->id();
            $table->unsignedInteger('next_number');
        });
    }

    /**
     * @return void
     */
    public function down(): void
    {
        Schema::dropIfExists('case_number_sequence');
    }
};
