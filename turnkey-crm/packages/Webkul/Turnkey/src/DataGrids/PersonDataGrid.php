<?php

namespace Webkul\Turnkey\DataGrids;

class PersonDataGrid extends \Webkul\Admin\DataGrids\Contact\PersonDataGrid
{
    use PresentsRecords;

    protected string $screen = 'persons';
}
