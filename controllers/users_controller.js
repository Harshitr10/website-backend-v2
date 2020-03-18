const kue = require("../config/Scheduler/kue");
const worker = require("../config/Scheduler/worker");
const ObjectId = require("mongoose").Types.ObjectId;

const { ENV, AVATAR_URL } = require("../config/index");

// import http status codes
const {
	BAD_REQUEST,
	NOT_AUTHORIZED,
	FORBIDDEN
} = require("../utility/statusCodes");
// import constants
const { USER_HASH_LENGTH } = require("../config/index");
// import helper functions
const {
	sendError,
	sendSuccess,
	generateHash,
	checkToken,
	setToken
} = require("../utility/helpers");
const { deleteImage } = require("../config/imageService");

module.exports.users = async (req, res) => {
	let { id, sortBy, sortType } = req.query;
	let users;
	if (id) {
		users = await User.findById(id);
	} else {
		let role = ["core", "member"];
		sortBy ? sortBy : "name";
		sortType ? sortType : "asc";
		users = await User.find({ role: { $in: role } }).sort({
			[sortBy]: sortType
		});
	}
	sendSuccess(res, users);
};

module.exports.addUser = async (req, res) => {
	let { name, email, role, designation } = req.body;
	let user = await User.findOne({ email });
	if (user) {
		sendError(res, "Already exist!!", BAD_REQUEST);
	} else {
		if (req.user.role === "core" && (role === "lead" || role === "core")) {
			sendError(
				res,
				"Forbidden: Core members cannot add lead/core members",
				NOT_AUTHORIZED
			);
		} else if (req.user.role === "lead" && role === "lead") {
			sendError(
				res,
				"Forbidden: A lead cannot add another lead",
				NOT_AUTHORIZED
			);
		} else {
			let password = generateHash(USER_HASH_LENGTH);
			user = new User({
				name,
				email,
				role,
				designation,
				password,
				image: `${AVATAR_URL}${Math.floor(Math.random() * 10000) +
					9999}.svg`
			});
			user = await user.save();

			const token = user.generateAuthToken();
			setToken(String(user._id), token);
			let args = {
				jobName: "sendLoginCreds",
				time: Date.now(),
				params: {
					email,
					password,
					name,
					role
				}
			};
			kue.scheduleJob(args);
			sendSuccess(res, user);
		}
	}
};

module.exports.login = async (req, res) => {
	let { email, password } = req.body;
	let user = await User.findOne({
		email: { $regex: `^${email}$`, $options: "i" }
	});
	if (!user) return sendError(res, "Invalid User", BAD_REQUEST);
	const validPassword = await user.isValidPwd(String(password).trim());
	if (!validPassword) return sendError(res, "Invalid Password", BAD_REQUEST);
	user.lastLogin = new Date(Date.now()).toISOString();
	await user.save();
	let token = await checkToken(String(user._id));
	if (token) {
		if (token === "revoked") {
			return sendError(res, "Account Revoked, Logout!", FORBIDDEN);
		} else if (token === "revalidate") {
			token = user.generateAuthToken();
			setToken(String(user._id), token);
		}
	} else {
		return sendError(res, "Account Suspended, Logout!", FORBIDDEN);
	}
	sendSuccess(res, user, token);
};

module.exports.toggleShowOnWeb = async (req, res) => {
	let { id } = req.params;
	let user = await User.findById(id);
	if (!user) {
		return sendError(res, "Invalid User", BAD_REQUEST);
	}
	user.showOnWebsite = user.showOnWebsite ? false : true;
	user = await user.save();
	sendSuccess(res, user);
};

module.exports.toggleRevoke = async (req, res) => {
	let { id } = req.params;
	let user = await User.findById(id);
	if (!user) {
		return sendError(res, "Invalid User", BAD_REQUEST);
	}
	//toggle the revoke status of user
	user.isRevoked = user.isRevoked ? false : true;

	//change token status
	user.isRevoked ? setToken(id, "revoke") : setToken(id, "revalidate");

	user = await user.save();
	sendSuccess(res, user);
};

module.exports.deleteUser = async (req, res) => {
	let { id } = req.params;

	let user = await User.findById(id);
	if (req.user.role === "core" && user.role !== "member") {
		sendError(
			res,
			"Forbidden: Core members cannot delete lead/core members",
			NOT_AUTHORIZED
		);
	} else {
		if (user.image && user.image.includes("amazonaws")) {
			let key = `${user.image.split("/")[3]}/${user.image.split("/")[4]}`;
			await deleteImage(key);
		}
		await user.delete();
		setToken(id, "delete");
		sendSuccess(res, null);
	}
};

module.exports.profile = async (req, res) => {
	let profile;
	if (req.query.id) {
		profile = await User.findById(req.query.id);
	} else {
		profile = await User.findById(req.user.id);
	}
	sendSuccess(res, profile);
};

module.exports.updateProfile = async (req, res) => {
	let {
		name,
		password,
		contact,
		designation,
		github,
		linkedin,
		twitter,
		portfolio
	} = req.body;
	let profile = await User.findById(req.query.id);
	if (!profile) {
		return sendError(res, "No Profile Found", BAD_REQUEST);
	}
	profile.name = name;
	profile.contact = contact;
	profile.designation = designation;
	profile.github = github;
	profile.linkedin = linkedin;
	profile.twitter = twitter;
	profile.portfolio = portfolio;
	profile.password = password;

	if (req.files) {
		if (profile.image && profile.image.includes("amazonaws")) {
			let key = `${profile.image.split("/")[3]}/${
				profile.image.split("/")[4]
			}`;
			await deleteImage(key);
		}
		profile.image = req.files[0].location;
	}

	await profile.save();
	profile = await User.findById(profile._id);
	sendSuccess(res, profile);
};

module.exports.temp = async (req, res) => {
	if (ENV === "prod") {
		return sendError(res, "Unavailable!!", BAD_REQUEST);
	}

	// create root lead user
	let user = await new User({
		name: "root",
		email: "root@dsckiet.tech",
		password: "root@dsckiet123",
		role: "lead",
		designation: "lead"
	});
	const token = user.generateAuthToken();
	setToken(String(user._id), token);
	await user.save();

	// create random users
	// console.time("Participants Created in: ");
	// let branches = ["CS", "IT", "EC", "EN", "ME", "CE", "CO", "CSI", "MCA"],
	// 	years = [1, 2, 3, 4],
	// 	chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
	// 	numbers = "1234567890";
	// let entries = 200;
	// for (let i = 0; i < entries; i++) {
	// 	let part = new Participant({
	// 		name: generateHash(10),
	// 		email: `${generateHash(8)}@gmail.com`,
	// 		branch: branches[Math.floor(Math.random() * branches.length)],
	// 		year: years[Math.floor(Math.random() * years.length)],
	// 		password: generateHash(USER_HASH_LENGTH),
	// 		phone: 9876543210
	// 	});
	// 	await part.save();
	// 	console.log(`Partcipant ${i} created...`);
	// }
	// console.timeEnd("Participants Created in: ");

	// register random participants in event
	// console.time("Participants Registered in event in: ");
	// // let entries = 200;
	// let eventId = new ObjectId("5e6fe1b985e811179472ca44");
	// let participants = await Participant.find()
	// 	.sort({ name: "asc" })
	// 	.limit(entries);

	// for (let i = 0; i < entries; i++) {
	// 	let attendance = new Attendance({
	// 		participant: new ObjectId(participants[i]._id),
	// 		event: new ObjectId(eventId),
	// 		attend: []
	// 	});

	// 	participants[i].events.push({
	// 		event: new ObjectId(eventId),
	// 		attendance: new ObjectId(attendance._id),
	// 		status: "not attended"
	// 	});
	// 	[part, attendance] = await Promise.all([
	// 		participants[i].save(),
	// 		attendance.save()
	// 	]);
	// 	console.log(`Participant ${i} registered in event`);
	// }
	// console.timeEnd("Participants Registered in event in: ");

	// mark random attendences
	// console.time("Marked in: ");
	// let code = "AyI89CdiIUbWnlWtGMNO",
	// 	eventId = "5e6dfb7caad4441a9ceb5b2e",
	// 	entries = 49;
	// let [event, participants] = await Promise.all([
	// 	Event.findOne({ code }),
	// 	Participant.find({ "events.event": new ObjectId(eventId) }).limit(
	// 		entries
	// 	)
	// ]);
	// if (!event) {
	// 	return sendError(res, "Invalid Code!!", BAD_REQUEST);
	// }
	// let cnt = 0;
	// for (let i = 0; i < entries; i++) {
	// 	let attendance = await Attendance.findOne({
	// 		$and: [{ event: event._id }, { participant: participants[i]._id }]
	// 	});
	// 	if (!attendance) {
	// 		continue;
	// 	}
	// 	let dates = [15, 16, 17, 18, 19];

	// 	let currTime = new Date(Date.now());
	// 	let today = new Date(
	// 		currTime.getFullYear(),
	// 		currTime.getMonth(),
	// 		dates[Math.floor(Math.random() * 5)]
	// 	).toISOString();

	// 	if (
	// 		today < new Date(event.startDate).toISOString() ||
	// 		today > new Date(event.endDate).toISOString()
	// 	) {
	// 		continue;
	// 	}

	// 	let attendIndex = attendance.attend
	// 		.map(attend => {
	// 			return new Date(attend).toISOString();
	// 		})
	// 		.indexOf(today);

	// 	if (attendIndex !== -1) {
	// 		continue;
	// 	} else {
	// 		attendance.attend.push(today);
	// 		let eventInd = participants[i].events
	// 			.map(event => {
	// 				return String(event.event);
	// 			})
	// 			.indexOf(String(event._id));
	// 		let daysPresent = attendance.attend.length;
	// 		if (daysPresent < event.days) {
	// 			participants[i].events[eventInd].status = "partially attended";
	// 		} else {
	// 			participants[i].events[eventInd].status = "attended";
	// 		}
	// 		await Promise.all([attendance.save(), participants[i].save()]);
	// 		console.log(`Attendance Marked for Part ${i} of ${today}`);
	// 		cnt++;
	// 	}
	// }
	// console.log(`Attendences Marked: ${cnt}`);
	// console.timeEnd("Marked in: ");
	sendSuccess(res, null);
};
