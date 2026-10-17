@props(['status'])
<span class="status-badge status-{{ $status instanceof \BackedEnum ? $status->value : $status }}"><span></span>{{ $status instanceof \BackedEnum ? $status->label() : ucfirst(str_replace('_', ' ', $status)) }}</span>
