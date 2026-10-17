<?php

namespace Database\Seeders;

use App\Models\TrackedSender;
use App\Support\SenderAddress;
use Illuminate\Database\Seeder;
use InvalidArgumentException;

class TrackedSenderSeeder extends Seeder
{
    /**
     * @return void
     *
     * @throws InvalidArgumentException
     */
    public function run(): void
    {
        foreach (require database_path('seeders/data/senders.php') as $row) {
            $address = SenderAddress::fromHeader($row['header']);

            TrackedSender::query()->create([
                'email' => $address->email,
                'name' => $address->name,
                'label' => $row['label'],
                'is_active' => $row['is_active'],
            ]);
        }
    }
}
