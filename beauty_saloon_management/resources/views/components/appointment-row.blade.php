<tr>
    <td><strong>{{ $appointment->localStart()->format('H:i') }}</strong><small>{{ $appointment->localEnd()->format('H:i') }}</small>
    </td>
    <td><a class="person" href="{{ route('appointments.show', $appointment) }}"><span
                class="avatar tone-{{ $appointment->client_id % 4 }}">{{ $appointment->client->initials() }}</span><span><strong>{{ $appointment->client->name }}</strong><small>{{ $appointment->items->pluck('name')->implode(' + ') }}</small></span></a>
    </td>
    <td><span class="stylist-dot"
            style="--stylist: {{ $appointment->stylist->color }}"></span>{{ $appointment->stylist->name }}</td>
    <td>@include('components.status', ['status' => $appointment->status])</td>
    <td class="align-right"><a class="row-arrow" href="{{ route('appointments.show', $appointment) }}"
            aria-label="View {{ $appointment->client->name }} appointment">↗</a></td>
</tr>
