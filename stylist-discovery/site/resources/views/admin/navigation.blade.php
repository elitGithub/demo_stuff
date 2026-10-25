<nav class="admin-navigation" aria-label="Admin workspace">
    <a href="{{ route('admin.index') }}" @if(request()->routeIs('admin.index')) aria-current="page" @endif>Overview</a>
    <a href="{{ route('admin.applications') }}" @if(request()->routeIs('admin.applications', 'admin.application', 'admin.publish', 'admin.suspend')) aria-current="page" @endif>Studio reviews</a>
    <a href="{{ route('admin.bookings') }}" @if(request()->routeIs('admin.bookings')) aria-current="page" @endif>Appointments</a>
    <a href="{{ route('admin.specialties') }}" @if(request()->routeIs('admin.specialties*')) aria-current="page" @endif>Specialties</a>
</nav>
