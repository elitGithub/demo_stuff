@extends('layouts.app')
@section('title', 'Your account')
@section('content')
<div class="page-heading"><div><h1>Your account.</h1><p>Update your contact details or change your password.</p></div></div>
<section class="panel"><form class="stack" method="post" action="{{ route('profile.update') }}">@csrf @method('PUT')
<div class="form-grid"><label>Name<input name="name" value="{{ old('name', auth()->user()->name) }}" required maxlength="120"></label><label>Email<input type="email" name="email" value="{{ old('email', auth()->user()->email) }}" required></label></div>
<label>Current password<input type="password" name="current_password" autocomplete="current-password" required></label>
<div class="form-grid"><label>New password (optional)<input type="password" name="password" minlength="12" autocomplete="new-password"></label><label>Confirm new password<input type="password" name="password_confirmation" minlength="12" autocomplete="new-password"></label></div><button class="button">Save account</button></form></section>
@endsection
