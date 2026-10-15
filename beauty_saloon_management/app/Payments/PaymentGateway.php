<?php

namespace App\Payments;

use App\Models\Invoice;

interface PaymentGateway
{
    public function available(): bool;

    public function checkout(Invoice $invoice): string;
}
