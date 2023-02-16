import { Context, Service, ServiceSchema, Errors } from "moleculer";
import type { DbAdapter, DbServiceSettings, MoleculerDbMethods } from "moleculer-db";
import type MongoDbAdapter from "moleculer-db-adapter-mongo";
import slug from "slug";
import type { DbServiceMethods } from "../mixins/db.mixin";
import DbMixin from "../mixins/db.mixin";

const { MoleculerClientError, ValidationError } = Errors;

export interface ChannelEntity {
	_id: string;
	title: string;
	description: string;
	quantity: number;
}

interface Meta {
	user?: ChannelEntity | null | undefined;
}

export type ActionCreateParams = Partial<ChannelEntity>;

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
}

interface ChannelSettings extends DbServiceSettings {
	indexes?: Record<string, number>[];
}

interface ChannelThis extends Service<ChannelSettings>, MoleculerDbMethods {
	adapter: DbAdapter | MongoDbAdapter;
}

const TopicService: ServiceSchema<ChannelSettings> & { methods: DbServiceMethods } = {
	name: "topics",
	// version: 1

	/**
	 * Mixins
	 */
	mixins: [DbMixin("topics")],

	/**
	 * Settings
	 */
	settings: {
		// Available fields in the responses
		fields: ["_id", "title", "slug", "description", "createdAt", "updatedAt", "creator"],

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
		 * Create a new channel.
		 * Auth is required!
		 *
		 * @actions
		 * @param {Object} channel - Channel entity
		 *
		 * @returns {Object} Created entity
		 */
		create: {
			auth: "required",
			params: {
				channel: { type: "string" },
				topic: { type: "object" },
			},
			handler(this: ChannelThis, ctx: Context<ActionQuantityParams, Meta>) {
				let entity = ctx.params.topic;
				entity.channel = ctx.params.channel;
				const { user } = ctx.meta;
				entity.creator = user?._id.toString();

				return this.validateEntity(entity).then(() => {
					entity.slug =
						slug(entity.title, { lower: true }) +
						"-" +
						((Math.random() * Math.pow(36, 6)) | 0).toString(36);
					entity.createdAt = new Date();
					entity.updatedAt = new Date();

					return this.adapter
						.insert(entity)
						.then((doc) => this.transformDocuments(ctx, { populate: ["creator"] }, doc))
						.then((entity) => this.transformResult(ctx, entity, ctx.meta.user))
						.then((json) => this.entityChanged("created", json, ctx).then(() => json));
				});
			},
		},

		/**
		 * List topic with pagination.
		 *
		 * @actions
		 * @param {String} channel - Filter for acreatoruthor ID
		 * @param {Number} limit - Pagination limit
		 * @param {Number} offset - Pagination offset
		 *
		 * @returns {Object} List of topic
		 */
		list: {
			cache: {
				keys: ["#token", "channel", "limit", "offset"],
			},
			params: {
				channel: { type: "string" },
				limit: { type: "number", optional: true, convert: true },
				offset: { type: "number", optional: true, convert: true },
			},
			handler(this: ChannelThis, ctx: Context<ActionQuantityParams, Meta>) {
				const limit = ctx.params.limit ? Number(ctx.params.limit) : 20;
				const offset = ctx.params.offset ? Number(ctx.params.offset) : 0;

				let params = {
					limit,
					offset,
					sort: ["-createdAt"],
					populate: ["creator"],
					query: {
						channel: ctx.params.channel,
					},
				};
				let countParams: any;

				return Promise.resolve()
					.then(() => {
						countParams = Object.assign({}, params);
						// Remove pagination params
						if (countParams && countParams.limit) countParams.limit = null;
						if (countParams && countParams.offset) countParams.offset = null;
					})
					.then(() =>
						Promise.all([
							// Get rows
							this.adapter.find(params),

							// Get count of all rows
							this.adapter.count(countParams),
						]),
					)
					.then((res) => {
						return this.transformDocuments(ctx, params, res[0])
							.then((docs: any) => this.transformResult(ctx, docs, ctx.meta.user))
							.then((r: any) => {
								r.topicCount = res[1];
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
		 * Find an Channel by slug
		 *
		 * @param {String} slug - Channel slug
		 *
		 * @results {Object} Promise<Article
		 */
		findBySlug(slug) {
			return this.adapter.findOne({ slug });
		},

		/**
		 *
		 * @param {Context} ctx
		 * @param {Array} entities
		 * @param {Object} user - Logged in user
		 */
		transformResult(this: any, ctx, entities, user) {
			if (Array.isArray(entities)) {
				return this.Promise.mapSeries(entities, (item: any) =>
					this.transformEntity(ctx, item, user),
				).then((topics: any) => ({ topics }));
			} else {
				return this.transformEntity(ctx, entities, user).then((topic: any) => ({
					topic,
				}));
			}
		},
		/**
		 *
		 * @param {Context} ctx
		 * @param {Object} entity
		 * @param {Object} user - Logged in user
		 */
		transformEntity(ctx, entity, user) {
			if (!entity) return Promise.resolve();
			return Promise.resolve(entity);
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

export default TopicService;
