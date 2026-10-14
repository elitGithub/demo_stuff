<?php

namespace Webkul\Turnkey\DataGrids;

class LeadDataGrid extends \Webkul\Admin\DataGrids\Lead\LeadDataGrid
{
    use PresentsRecords;

    protected string $screen = 'leads';
}
