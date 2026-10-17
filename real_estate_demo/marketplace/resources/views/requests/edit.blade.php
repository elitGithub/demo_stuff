<x-app-layout title="Edit your request">
    <div class="page-heading"><p class="eyebrow">GET THE DETAILS JUST RIGHT</p><h1>Update your request.</h1><p>You can edit the scope until the first proposal arrives.</p></div>
    <form method="POST" action="{{ route('requests.update', $job) }}" class="content-panel padded request-form">@csrf @method('PATCH') @include('requests._form')</form>
</x-app-layout>
