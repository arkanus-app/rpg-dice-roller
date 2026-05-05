const textSymbol: unique symbol = Symbol('text');
const typeSymbol: unique symbol = Symbol('type');

const descriptionTypes = Object.freeze({
  MULTILINE: 'multiline',
  INLINE: 'inline',
});

export type DescriptionType = (typeof descriptionTypes)[keyof typeof descriptionTypes];

export interface DescriptionJSON {
  text: string;
  type: string;
}

/**
 * Represents a Roll / Roll group description.
 */
class Description {
  static types = descriptionTypes;

  private [textSymbol]!: string;

  private [typeSymbol]!: string;

  /**
   * Create a `Description` instance.
   *
   * @param {string} text
   * @param {string} [type=inline]
   */
  constructor(text: string | number, type: string = descriptionTypes.INLINE) {
    this.text = text;
    this.type = type;
  }

  /**
   * The description text.
   *
   * @return {string}
   */
  get text(): string {
    return this[textSymbol];
  }

  /**
   * Set the description text.
   *
   * @param {string|number} text
   */
  set text(text: string | number) {
    if (typeof text === 'object') {
      throw new TypeError('Description text is invalid');
    } else if ((!text && (text !== 0)) || (`${text}`.trim() === '')) {
      throw new TypeError('Description text cannot be empty');
    }

    this[textSymbol] = `${text}`.trim();
  }

  /**
   * The description type.
   *
   * @return {string} "inline" or "multiline"
   */
  get type(): string {
    return this[typeSymbol];
  }

  /**
   * Set the description type.
   *
   * @param {string} type
   */
  set type(type: string) {
    const types = Object.values((this.constructor as typeof Description).types);

    if (typeof type !== 'string') {
      throw new TypeError('Description type must be a string');
    } else if (!types.includes(type as DescriptionType)) {
      throw new RangeError(`Description type must be one of; ${types.join(', ')}`);
    }

    this[typeSymbol] = type;
  }

  /**
   * Return an object for JSON serialising.
   *
   * This is called automatically when JSON encoding the object.
   *
   * @return {{text: string, type: string}}
   */
  toJSON(): DescriptionJSON {
    const { text, type } = this;

    return {
      text,
      type,
    };
  }

  /**
   * Return the String representation of the object.
   *
   * This is called automatically when casting the object to a string.
   *
   * @see {@link Description#text}
   *
   * @returns {string}
   */
  toString(): string {
    if (this.type === (this.constructor as typeof Description).types.INLINE) {
      return `# ${this.text}`;
    }

    return `[${this.text}]`;
  }
}

export default Description;
