var snoowrap = require('snoowrap'), config;

if (process.env.client_id){
	config = {
		client_id: process.env.client_id,
		client_secret: process.env.client_secret,
		refresh_token: process.env.refresh_token,
		user_agent: 'OuijaBot'
	};
} else {
	config = require('./config.js');
}

const OUIJA_RESULT_CLASS = 'ouija-result';

const r = new snoowrap(config);

var sId = process.argv[2];

if (sId){
	processPost(r.get_submission(sId));
} else {
	checkHot();
}

// *********** FUNCTIONS *************

function checkHot(){
	console.log('checking last 100 hot posts');
	r.get_hot('AskOuija', { limit: 100 }).then(hot => {
		hot.forEach(processPost);
	});
}

function processPost(post){
	if (post.link_flair_text) return;
	post.expand_replies().then(processComments);
}

function processComments(post){
	var length = post.comments.length,
		letters;

	for (let i = 0; i < length; i++){
		letters = getOuijaLetters(post.comments[i]);
		if (letters){
			updatePostFlair(post, letters);
			return;
		}
	}
}

function updatePostFlair(post, letters){
	var text = 'Ouija says: ' + letters.join('');

	if (post.link_flair_text == text){
		console.log('confirmed flair: ' + text);
	} else {
		post.assign_flair({
			text,
			css_class: OUIJA_RESULT_CLASS
		}).catch(err => {
			console.error(err);
		});
		console.log('assigned flair: ' + text);
	}
}

var goodbye = /^GOODBYE/;

function getBody(comment){
	return comment && comment.body.trim().toUpperCase();
}

function getOuijaLetters(comment){
	var body = getBody(comment),
		letters = [];

	while (body && body.length === 1){
		letters.push(body);
		comment = comment.replies[0];
		body = getBody(comment);
		if (goodbye.test(body) && comment.score > 1){
			return letters;
		}
	}

	return false;
}