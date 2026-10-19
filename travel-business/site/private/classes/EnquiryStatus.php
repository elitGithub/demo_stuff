<?php

namespace Elsewhere;

enum EnquiryStatus: string
{
    case New = 'new';
    case Contacted = 'contacted';
    case Proposal = 'proposal';
    case Converted = 'converted';
    case Closed = 'closed';

    /** @return string */
    public function label(): string { return ucfirst($this->value); }
}
