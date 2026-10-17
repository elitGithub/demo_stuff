<x-app-layout title="Settings">
    <div class="settings-page">
        <header>
            <p class="eyebrow">Your mailbox</p>
            <h1>Settings</h1>
            <p class="muted">Choose whose emails become cases. Deactivating a sender keeps their existing cases.</p>
        </header>
        <x-connected-mailbox-card />
        @php($addErrors = $errors->getBag('addSender'))
        <section class="surface settings-section" aria-labelledby="add-sender-heading">
            <h2 id="add-sender-heading" class="section-title">Add a tracked sender</h2>
            <form id="add-sender" method="POST" action="{{ route('senders.store') }}" data-pending>
                @csrf
                <div class="sender-fields">
                    <div class="field">
                        <label for="sender-email">Email <span class="required-mark" aria-hidden="true">*</span><span class="sr-only"> (required)</span></label>
                        <input id="sender-email" type="text" name="email" inputmode="email" autocomplete="email" required value="{{ $addErrors->any() && is_string(old('email')) ? old('email') : '' }}" aria-invalid="{{ $addErrors->has('email') ? 'true' : 'false' }}" aria-describedby="sender-email-help{{ $addErrors->has('email') ? ' sender-email-error' : '' }}">
                        <p id="sender-email-help" class="field-help">An address or a name and address, such as Sam Whitfield &lt;sam.whitfield@mail.example&gt;.</p>
                        @if ($addErrors->has('email'))<p id="sender-email-error" class="field-error">{{ $addErrors->first('email') }}</p>@endif
                    </div>
                    <div class="field">
                        <label for="sender-name">Name <span class="required-mark" aria-hidden="true">*</span><span class="sr-only"> (required)</span></label>
                        <input id="sender-name" type="text" name="name" maxlength="120" required value="{{ $addErrors->any() && is_string(old('name')) ? old('name') : '' }}" aria-invalid="{{ $addErrors->has('name') ? 'true' : 'false' }}" @if ($addErrors->has('name')) aria-describedby="sender-name-error" @endif>
                        @if ($addErrors->has('name'))<p id="sender-name-error" class="field-error">{{ $addErrors->first('name') }}</p>@endif
                    </div>
                    <div class="field">
                        <label for="sender-label">Label</label>
                        <input id="sender-label" type="text" name="label" maxlength="60" value="{{ $addErrors->any() && is_string(old('label')) ? old('label') : '' }}" aria-invalid="{{ $addErrors->has('label') ? 'true' : 'false' }}" @if ($addErrors->has('label')) aria-describedby="sender-label-error" @endif>
                        @if ($addErrors->has('label'))<p id="sender-label-error" class="field-error">{{ $addErrors->first('label') }}</p>@endif
                    </div>
                </div>
                <div class="form-actions"><button type="submit" class="btn btn-primary">Add sender</button></div>
            </form>
        </section>
        <section id="tracked-senders" class="surface sender-list" aria-labelledby="tracked-senders-heading">
            <header class="settings-section">
                <h2 id="tracked-senders-heading" class="section-title">Tracked senders</h2>
                <p class="muted">{{ $senders->total() }} {{ $senders->total() === 1 ? 'sender' : 'senders' }}. Listed by name.</p>
            </header>
            @if ($senders->isEmpty())
                <x-empty-state :title="$senders->total() === 0 ? 'No tracked senders yet.' : 'No senders on this page.'">
                    @if ($senders->total() > 0)
                        <a href="{{ route('settings') }}#tracked-senders" class="btn" data-pending>First page</a>
                    @else
                        Add a sender to turn their existing and future inbox emails into cases.
                    @endif
                </x-empty-state>
            @else
                <table class="sender-table">
                    <caption class="sr-only">Tracked senders and their case counts</caption>
                    <thead><tr><th scope="col">Sender</th><th scope="col">Tracking</th><th scope="col">Cases</th><th scope="col">Actions</th></tr></thead>
                    <tbody>
                        @foreach ($senders as $sender)
                            @php($renameErrors = $errors->getBag('renameSender'.$sender->id))
                            <tr id="sender-{{ $sender->id }}">
                                <th scope="row"><span>{{ $sender->name }}</span><span class="sender-address muted">{{ $sender->email }}</span>@if ($sender->label !== null)<span class="sender-address muted">{{ $sender->label }}</span>@endif</th>
                                <td><span class="sender-cell-label">Tracking: </span><span class="tracked-badge {{ $sender->is_active ? '' : 'tracked-badge-off' }}">{{ $sender->is_active ? 'Active' : 'Inactive' }}</span></td>
                                <td><span class="sender-cell-label">Cases: </span>{{ $sender->cases_count }}</td>
                                <td>
                                    <details class="sender-rename" @if ($renameErrors->any()) open @endif>
                                        <summary>Rename {{ $sender->name }}</summary>
                                        <form id="rename-sender-{{ $sender->id }}" method="POST" action="{{ route('senders.update', ['sender' => $sender, 'page' => $senders->currentPage()]) }}" data-pending>
                                            @csrf
                                            @method('PATCH')
                                            <div class="field">
                                                <label for="sender-{{ $sender->id }}-name">Name <span class="required-mark" aria-hidden="true">*</span><span class="sr-only"> (required)</span></label>
                                                <input id="sender-{{ $sender->id }}-name" type="text" name="name" required maxlength="120" value="{{ $renameErrors->any() ? (is_string(old('name')) ? old('name') : '') : $sender->name }}" aria-invalid="{{ $renameErrors->has('name') ? 'true' : 'false' }}" @if ($renameErrors->has('name')) aria-describedby="sender-{{ $sender->id }}-name-error" @endif>
                                                @if ($renameErrors->has('name'))<p id="sender-{{ $sender->id }}-name-error" class="field-error">{{ $renameErrors->first('name') }}</p>@endif
                                            </div>
                                            <div class="field">
                                                <label for="sender-{{ $sender->id }}-label">Label</label>
                                                <input id="sender-{{ $sender->id }}-label" type="text" name="label" maxlength="60" value="{{ $renameErrors->any() ? (is_string(old('label')) ? old('label') : '') : $sender->label }}" aria-invalid="{{ $renameErrors->has('label') ? 'true' : 'false' }}" @if ($renameErrors->has('label')) aria-describedby="sender-{{ $sender->id }}-label-error" @endif>
                                                @if ($renameErrors->has('label'))<p id="sender-{{ $sender->id }}-label-error" class="field-error">{{ $renameErrors->first('label') }}</p>@endif
                                            </div>
                                            <div class="form-actions">
                                                <a href="{{ route('settings', ['page' => $senders->currentPage()]) }}#sender-{{ $sender->id }}" class="btn btn-ghost" data-pending>Cancel</a>
                                                <button type="submit" class="btn btn-primary">Save</button>
                                            </div>
                                        </form>
                                    </details>
                                    <div class="sender-actions">
                                        <form method="POST" action="{{ route($sender->is_active ? 'senders.deactivate' : 'senders.reactivate', ['sender' => $sender, 'page' => $senders->currentPage()]) }}" data-pending>
                                            @csrf
                                            <button type="submit" class="btn">{{ $sender->is_active ? 'Deactivate' : 'Reactivate' }}</button>
                                        </form>
                                        @if ($sender->cases_count === 0)
                                            <form method="POST" action="{{ route('senders.destroy', ['sender' => $sender, 'page' => $senders->currentPage()]) }}" data-pending data-confirm="Delete this sender? Their future emails will stay untracked.">
                                                @csrf
                                                @method('DELETE')
                                                <button type="submit" class="btn btn-danger">Delete</button>
                                            </form>
                                        @endif
                                    </div>
                                </td>
                            </tr>
                        @endforeach
                    </tbody>
                </table>
            @endif
            <x-pagination :paginator="$senders" />
        </section>
    </div>
</x-app-layout>
