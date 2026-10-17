<x-public-layout title="Services for your home">
    <section class="page-heading centered"><p class="eyebrow">A LITTLE CARE GOES A LONG WAY</p><h1>Every corner, covered.</h1><p>Find the right help for whatever home has in mind.</p></section>
    <div class="category-grid category-directory">
        @foreach($categories as $category)<a class="category-card category-tone-{{ $loop->index % 6 }}" href="{{ route('professionals.index', ['category' => $category->id]) }}"><span class="category-icon"><x-icon :name="$category->icon" /></span><h3>{{ $category->name }}</h3><p>{{ $category->description }}</p><x-icon name="arrow" class="category-arrow" /></a>@endforeach
    </div>
    <div class="centered section"><a class="button primary" href="{{ route('requests.create') }}">Already have something in mind? Post a request <x-icon name="arrow" /></a></div>
</x-public-layout>
