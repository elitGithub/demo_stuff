<?php

namespace Webkul\Turnkey\DataGrids;

class QuoteDataGrid extends \Webkul\Admin\DataGrids\Quote\QuoteDataGrid
{
    use PresentsRecords;

    protected string $screen = 'quotes';
}
