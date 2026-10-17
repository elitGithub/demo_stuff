<?php

namespace App\Exceptions;

use Exception;

class SenderHasCases extends Exception
{
    /**
     * @return void
     */
    public function __construct()
    {
        parent::__construct('This sender has cases; deactivate it instead.');
    }
}
