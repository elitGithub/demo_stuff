<?php

namespace App\Payments;

use App\Models\Invoice;
use LogicException;

/** Boundary for future hosted Checkout; activation requires verified, idempotent webhooks. */
class StripeGateway implements PaymentGateway
{
    public function available(): bool
    {
        return false;
    }

    public function checkout(Invoice $invoice): string
    {
        throw new LogicException('Online collection is not enabled. Configure Stripe Checkout and verified payment webhooks before activation.');
    }
}
