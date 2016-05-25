var snoowrap = require('snoowrap'),
	config = require('./config.js');

const OUIJA_RESULT_CLASS = 'ouija-result';

const r = new snoowrap(config);

var sId = process.argv[2];

if (sId){
	processPost(r.get_submission(sId));
} else {
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

function getOuijaLetters(comment){
	var body = comment.body.trim().toUpperCase(),
		letters = [];

	while (body && body.length === 1){
		letters.push(body);
		comment = comment.replies[0];
		body = comment && comment.body.trim().toUpperCase();
		if (goodbye.test(body) && comment.score > 1){
			return letters;
		}
	}

	return false;
}