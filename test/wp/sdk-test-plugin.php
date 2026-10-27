<?php
/**
 * Plugin Name: wordpress-rest-sdk test fixtures
 * Description: A custom post type with registered meta, so site-specific type generation has something to find.
 */
add_action( 'init', function () {
	register_post_type( 'book', array(
		'label'        => 'Books',
		'public'       => true,
		'show_in_rest' => true,
		'rest_base'    => 'books',
		'supports'     => array( 'title', 'editor', 'custom-fields', 'thumbnail', 'revisions' ),
	) );
	register_post_meta( 'book', 'isbn', array( 'type' => 'string', 'single' => true, 'show_in_rest' => true, 'description' => 'International Standard Book Number.' ) );
	register_post_meta( 'book', 'page_count', array( 'type' => 'integer', 'single' => true, 'show_in_rest' => true ) );
	register_taxonomy( 'genre', 'book', array( 'label' => 'Genres', 'show_in_rest' => true, 'rest_base' => 'genres', 'hierarchical' => true ) );
} );
