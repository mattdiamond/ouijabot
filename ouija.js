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

const SECOND = 1000;
const MINUTE = 60 * SECOND;

var interval = 30 * MINUTE;

if (sId){
	processPost(r.get_submission(sId));
} else {
	checkHot();
	setInterval(checkHot, interval);
}

function checkHot(){
	console.log('checking hot posts');
	r.get_hot('AskOuija', { limit: 100 }).then(hot => {
		hot.forEach(processPost);
	});
}

// *********** FUNCTIONS *************

function processPost(post){
	if (post.link_flair_text) return;
	post.expand_replies().then(processComments);
}

function processComments(post){
	var i = 0, comment, letters;

	while (!letters){
		comment = post.comments[i++];
		if (!comment) return;
		letters = getOuijaLetters(comment);
	}

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

var goodbye = /^goodbye/i;

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