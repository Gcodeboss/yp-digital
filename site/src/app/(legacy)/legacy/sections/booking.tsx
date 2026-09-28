"use client";

import Link from "next/link";

export function BookingSection() {
  return (
    <section
      id="contact"
      className="relative bg-[rgb(19,27,14)] py-16 md:py-24"
      style={{
        backgroundImage: "url('/legacy/backgrounds/Booking.jpg')",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative z-10 legacy-container">
        <div className="grid gap-12 lg:grid-cols-2">
          {/* Left info */}
          <div>
            <h2 className="mb-4 font-serif text-[clamp(2rem,4vw,3.5rem)] font-normal uppercase tracking-tight text-[rgb(255,145,77)]">
              Booking
            </h2>
            <p className="mb-2 font-mono text-sm uppercase tracking-[0.15em] text-white/70">
              General Inquiries
            </p>
            <Link
              href="mailto:contact@emteemusicgroup.com"
              className="text-lg text-[rgb(255,145,77)] transition-colors hover:text-white"
            >
              contact@emteemusicgroup.com
            </Link>
          </div>

          {/* Right form */}
          <div>
            <h2 className="mb-8 font-serif text-[clamp(1.75rem,3vw,2.5rem)] font-normal uppercase tracking-tight text-[rgb(255,145,77)]">
              Work With Yanchan
            </h2>
            <form className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <input
                  type="text"
                  placeholder="First Name*"
                  required
                  className="border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/50 focus:border-[rgb(255,145,77)] focus:outline-none"
                />
                <input
                  type="text"
                  placeholder="Last Name"
                  className="border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/50 focus:border-[rgb(255,145,77)] focus:outline-none"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <input
                  type="tel"
                  placeholder="Phone Number*"
                  required
                  className="border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/50 focus:border-[rgb(255,145,77)] focus:outline-none"
                />
                <input
                  type="email"
                  placeholder="Email Address*"
                  required
                  className="border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/50 focus:border-[rgb(255,145,77)] focus:outline-none"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <input
                  type="text"
                  placeholder="Subject"
                  className="border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/50 focus:border-[rgb(255,145,77)] focus:outline-none"
                />
                <select className="border border-white/20 bg-white/10 px-4 py-3 text-sm text-white/50 focus:border-[rgb(255,145,77)] focus:outline-none">
                  <option>General Inquiries</option>
                  <option>Beat Samples</option>
                  <option>Custom Production</option>
                  <option>Performance Booking</option>
                </select>
              </div>
              <textarea
                placeholder="Message"
                rows={4}
                className="border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/50 focus:border-[rgb(255,145,77)] focus:outline-none"
              />
              <button
                type="submit"
                className="w-full bg-[rgb(255,145,77)] px-8 py-4 font-mono text-sm font-bold uppercase tracking-[0.1em] text-black transition-colors hover:bg-white"
              >
                Submit
              </button>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}
