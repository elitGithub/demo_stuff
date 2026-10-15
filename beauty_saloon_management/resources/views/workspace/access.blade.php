@extends('layouts.app')
@section('title', 'Staff access')
@section('content')
<div class="page-heading"><div><span class="eyebrow">THE RIGHT ACCESS</span><h1>Your people, connected.</h1><p>Owners manage accounts. Managers handle sales and configuration. Staff care for clients and assigned enquiries.</p></div></div>
<section class="panel mb"><h2>Add an account</h2>@include('workspace.access-form', ['account' => null])</section>
<div class="catalogue-grid">@foreach($users as $account)<section class="panel"><h2>{{ $account->name }}</h2><p class="muted">{{ ucfirst($account->role) }} · {{ $account->active ? 'Active' : 'Disabled' }}</p><details><summary>Edit access</summary>@include('workspace.access-form')</details></section>@endforeach</div>
@endsection
