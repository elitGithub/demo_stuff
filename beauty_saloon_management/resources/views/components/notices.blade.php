@if (session('success'))
    <div class="notice success" role="status">
        @include('components.icon', ['name' => 'check']) {{ session('success') }}</div>
@endif
@if ($errors->any())
    <div class="notice error" role="alert">
        <div><strong>Please check the following</strong>
            <ul>
                @foreach ($errors->all() as $error)
                    <li>{{ $error }}</li>
                @endforeach
            </ul>
        </div>
    </div>
@endif
