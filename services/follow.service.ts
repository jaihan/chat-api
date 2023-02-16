import { Context, Service, ServiceSchema, Errors } from "moleculer";
import type { DbAdapter, DbServiceSettings, MoleculerDbMethods } from "moleculer-db";
import type MongoDbAdapter from "moleculer-db-adapter-mongo";
import slug from "slug";
import type { DbServiceMethods } from "../mixins/db.mixin";
import DbMixin from "../mixins/db.mixin";

const { MoleculerClientError, ValidationError } = Errors;

export interface FollowEntity {
	_id: string;
	title: string;
	description: string;
	quantity: number;
}

interface Meta {
	user?: FollowEntity | null | undefined;
}

export type ActionCreateParams = Partial<FollowEntity>;

export interface ActionQuantityParams {
	id: string;
	value: number;
	channel: any;
	creator: string;
	limit: any;
	offset: any;
	topic: any;
	slug: any;
	message: any;

	follow: string;
	user: string;
}

interface FollowSettings extends DbServiceSettings {
	indexes?: Record<string, number>[];
}

interface FollowThis extends Service<FollowSettings>, MoleculerDbMethods {
	adapter: DbAdapter | MongoDbAdapter;
}

const FollowService: ServiceSchema<FollowSettings> & { methods: DbServiceMethods } = {
	name: "follows",
	// version: 1

	/**
	 * Mixins
	 */
	mixins: [DbMixin("follows")],

	/**
	 * Settings
	 */
	settings: {
		// Available fields in the responses
		fields: ["_id", "user", "channel", "createdAt", "updatedAt"],

		// Validator for the `create` & `insert` actions.
		entityValidator: {
			title: "string|min:3",
			description: "string|min:3",
		},

		populates: {
			creator: {
				action: "users.get",
				params: {
					fields: ["_id", "username", "bio", "image"],
				},
			},
		},

		indexes: [{ name: 1 }],
	},

	/**
	 * Action Hooks
	 */
	hooks: {
		before: {
			/**
			 * Register a before hook for the `create` action.
			 * It sets a default value for the quantity field.
			 */
			create(ctx: Context<ActionCreateParams>) {
				ctx.params.quantity = 0;
			},
		},
	},

	/**
	 * Actions
	 */
	actions: {
		/**
		 * Create a new following record
		 *
		 * @actions
		 *
		 * @param {String} user - Follower username
		 * @param {String} follow - Followee username
		 * @returns {Object} Created following record
		 */
		add: {
			params: {
				channel: { type: "string" },
				user: { type: "string" },
			},
			handler(this: FollowThis, ctx: Context<ActionQuantityParams, Meta>) {
				const { channel, user } = ctx.params;
				return this.findByChannelAndUser(channel, user).then((item: any) => {
					if (item)
						return Promise.reject(
							new MoleculerClientError("Channel has already joined"),
						);

					return this.adapter
						.insert({ channel, user, createdAt: new Date() })
						.then((json) => this.entityChanged("created", json, ctx).then(() => json));
				});
			},
		},

		/**
		 * Delete a follow record
		 *
		 * @actions
		 *
		 * @param {String} article - Channel ID
		 * @param {String} user - User ID
		 * @returns {Number} Count of removed records
		 */
		delete: {
			params: {
				channel: { type: "string" },
				user: { type: "string" },
			},
			handler(this: FollowThis, ctx: Context<ActionQuantityParams, Meta>) {
				const { channel, user } = ctx.params;
				return this.findByChannelAndUser(channel, user).then((item: any) => {
					if (!item)
						return Promise.reject(
							new MoleculerClientError("Channel has not joined yet"),
						);

					return this.adapter
						.removeById(item._id)
						.then((json) => this.entityChanged("removed", json, ctx).then(() => json));
				});
			},
		},

		/**
		 * List articles with pagination.
		 *
		 * @actions
		 * @param {String} tag - Filter for 'tag'
		 * @param {String} author - Filter for author ID
		 * @param {String} favorited - Filter for favorited author
		 * @param {Number} limit - Pagination limit
		 * @param {Number} offset - Pagination offset
		 *
		 * @returns {Object} List of articles
		 */
		list: {
			cache: {
				keys: ["#token", "creator", "limit", "offset"],
			},
			params: {
				creator: { type: "string", optional: true },
				limit: { type: "number", optional: true, convert: true },
				offset: { type: "number", optional: true, convert: true },
			},
			handler(this: FollowThis, ctx: Context<ActionQuantityParams, Meta>) {
				const limit = ctx.params.limit ? Number(ctx.params.limit) : 20;
				const offset = ctx.params.offset ? Number(ctx.params.offset) : 0;

				let params: any = {
					limit,
					offset,
					sort: ["-createdAt"],
					populate: ["creater"],
					query: {},
				};
				let countParams: any;

				console.log("***********");
				console.log("***********");
				console.log("***********, ctx.params.creator");
				console.log(ctx.params.creator);
				console.log("***********, ctx.entity");
				return Promise.resolve()
					.then(() => {
						if (ctx.params.creator) {
							return ctx
								.call("users.find", { query: { username: ctx.params.creator } })
								.then((channels: any) => {
									console.log("***********");
									console.log("***********");
									console.log("***********, channels");
									console.log(channels);
									console.log("***********, ctx.entity");
									if (channels.length == 0)
										return Promise.reject(
											new MoleculerClientError("Creator not found"),
										);

									params.query.creator = channels[0]._id;
								});
						}
					})
					.then(() => {
						countParams = Object.assign({}, params);
						// Remove pagination params
						if (countParams && countParams.limit) countParams.limit = null;
						if (countParams && countParams.offset) countParams.offset = null;
					})
					.then(() => {
						return Promise.all([
							// Get rows
							this.adapter.find(params),

							// Get count of all rows
							this.adapter.count(countParams),
						]);
					})
					.then((res) => {
						console.log("***********");
						console.log("***********");
						console.log("***********, channels");
						console.log(res);
						console.log(params);
						console.log("***********, ctx.entity");
						return this.transformDocuments(ctx, params, res[0])
							.then((docs: any) => this.transformResult(ctx, docs, ctx.meta.user))
							.then((r: any) => {
								r.count = res[1];
								return r;
							});
					});
			},
		},

		/**
		 * Get an article by slug
		 *
		 * @actions
		 * @param {String} id - Article slug
		 *
		 * @returns {Object} Article entity
		 */
		get: {
			cache: {
				keys: ["#token", "id"],
			},
			params: {
				id: { type: "string" },
			},
			handler(this: any, ctx: Context<ActionQuantityParams, Meta>): Promise<object> {
				console.log("***********");
				console.log("***********, get");
				console.log("***********, ctx.meta");
				console.log(ctx.meta);
				console.log("***********, ctx.params");
				console.log(ctx.params);
				return this.findBySlug(ctx.params.id)
					.then((entity: any) => {
						if (!entity)
							return this.Promise.reject(
								new MoleculerClientError("Article not found!", 404),
							);

						return entity;
					})
					.then((doc: any) =>
						this.transformDocuments(ctx, { populate: ["creator"] }, doc),
					)
					.then((entity: any) => this.transformResult(ctx, entity, ctx.meta.user));
			},
		},

		/**
		 * Add a new comment to an article.
		 * Auth is required!
		 *
		 * @actions
		 * @param {String} slug - Article slug
		 * @param {Object} comment - Comment fields
		 *
		 * @returns {Object} Comment entity
		 */
		addMessage: {
			auth: "required",
			params: {
				slug: { type: "string" },
				message: { type: "object" },
			},
			handler(this: any, ctx: Context<ActionQuantityParams, Meta>): Promise<object> {
				return this.Promise.resolve(ctx.params.slug)
					.then((slug: string) => this.findBySlug(slug))
					.then((topic: any) => {
						if (!topic)
							return this.Promise.reject(
								new MoleculerClientError("Article not found", 404),
							);

						return ctx.call("messages.create", {
							topic: topic._id.toString(),
							message: ctx.params.message,
						});
					});
			},
		},
	},

	/**
	 * Methods
	 */
	methods: {
		/**
		 * Find an channel by slug
		 *
		 * @param {String} slug - Channel slug
		 *
		 * @results {Object} Promise<Article
		 */
		findBySlug(slug) {
			return this.adapter.findOne({ slug });
		},

		/**
		 * Transform the result entities to follow the RealWorld API spec
		 *
		 * @param {Context} ctx
		 * @param {Array} entities
		 * @param {Object} user - Logged in user
		 */
		transformResult(this: any, ctx, entities, user) {
			if (Array.isArray(entities)) {
				return this.Promise.mapSeries(entities, (item: any) =>
					this.transformEntity(ctx, item, user),
				).then((channels: any) => ({ channels }));
			} else {
				return this.transformEntity(ctx, entities, user).then((article: any) => ({
					article,
				}));
			}
		},
		/**
		 * Transform a result entity to follow the RealWorld API spec
		 *
		 * @param {Context} ctx
		 * @param {Object} entity
		 * @param {Object} user - Logged in user
		 */
		transformEntity(ctx, entity, user) {
			if (!entity) return Promise.resolve();
			return Promise.resolve(entity);
		},

		/**
		 * Find the first favorite record by 'article' or 'user'
		 * @param {String} article - Article ID
		 * @param {String} user - User ID
		 */
		findByChannelAndUser(channel, user) {
			return this.adapter.findOne({ channel, user });
		},
	},

	events: {
		"cache.clean.channels"() {
			if (this.broker.cacher) this.broker.cacher.clean(`${this.name}.*`);
		},
		"cache.clean.users"() {
			if (this.broker.cacher) this.broker.cacher.clean(`${this.name}.*`);
		},
		"cache.clean.topics"() {
			if (this.broker.cacher) this.broker.cacher.clean(`${this.name}.*`);
		},
		"cache.clean.follows"() {
			if (this.broker.cacher) this.broker.cacher.clean(`${this.name}.*`);
		},
	},
};

export default FollowService;
