// ------------- includes ------------------
var snoowrap = require('snoowrap');

// -------------- config -------------------
const config = {
	client_id: process.env.client_id,
	client_secret: process.env.client_secret,
	refresh_token: process.env.refresh_token,
	user_agent: 'OuijaBot'
};

// -------- constants & variables ----------

const
	OUIJA_RESULT_CLASS = 'ouija-result',
	COMMENT_SCORE_THRESHOLD = process.env.threshold;

var
	r = new snoowrap(config),
	submissionId = process.argv[2],
	goodbye = /^GOODBYE/,
	link = /\[(.+)\]\(.+\)/;

// -------------- { MAIN } -----------------

if (submissionId){
	processPost(r.get_submission(submissionId));
} else {
	checkHot();
}

// -------------- functions ----------------

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

	for (var i = 0; i < length; i++){
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

function getBody(comment){
	if (!comment) return null;

	var body = comment.body.trim().toUpperCase();
	return body.replace(link, '$1');
}

function getOuijaLetters(comment){
	var body = getBody(comment),
		letters = [];

	while (body && body.length === 1){
		letters.push(body);
		comment = comment.replies[0];
		body = getBody(comment);
	}

	if (!goodbye.test(body)){
		return false;
	}

	if (comment.score < COMMENT_SCORE_THRESHOLD){
		console.log('below threshold: '+letters.join('')+' | '+comment.score+' points');
		return false;
	}

	return letters;
}