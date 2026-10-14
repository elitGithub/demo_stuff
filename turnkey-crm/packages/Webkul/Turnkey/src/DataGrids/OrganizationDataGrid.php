<?php

namespace Webkul\Turnkey\DataGrids;

class OrganizationDataGrid extends \Webkul\Admin\DataGrids\Contact\OrganizationDataGrid
{
    use PresentsRecords;

    protected string $screen = 'organizations';
}
