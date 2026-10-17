@if(session('status'))
    <div class="flash success" role="status">{{ session('status') }}</div>
@endif
@if($errors->any())
    <div class="flash error" role="alert">
        <p>Please check the following:</p>
        <ul>@foreach($errors->all() as $error)<li>{{ $error }}</li>@endforeach</ul>
    </div>
@endif
