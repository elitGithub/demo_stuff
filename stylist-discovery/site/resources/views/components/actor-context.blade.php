<input type="hidden" name="_actor_context" value="{{ app(\App\Services\AccountService::class)->signedContext(request()->session(), auth()->user()) }}">
