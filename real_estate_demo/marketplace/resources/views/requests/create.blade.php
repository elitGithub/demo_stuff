<x-app-layout title="A little help starts here">
    <div class="page-heading"><p class="eyebrow">MAKE ROOM FOR A FRESH START</p><h1>What’s on your list?</h1><p>A few details help the right professional find you.</p></div>
    <form method="POST" action="{{ route('requests.store') }}" enctype="multipart/form-data" class="content-panel padded request-form">@csrf @include('requests._form')</form>
</x-app-layout>
