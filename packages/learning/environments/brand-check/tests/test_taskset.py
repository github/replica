import unittest

from replica_brand_check.taskset import TasksetError, load_taskset

from tests.support import digest, make_task, task_id, write_taskset

RENDERINGS = [("desktop", "light"), ("desktop", "dark"), ("narrow", "light"), ("narrow", "dark")]


def candidate(size: str = "desktop", theme: str = "light") -> dict:
    return dict(make_task(1)["images"][0], size=size, theme=theme)


def reference(**fields: str) -> dict:
    image = {key: value for key, value in candidate().items() if key not in ("size", "theme")}
    return dict(image, role="reference", **fields)


class LoadTasksetTest(unittest.TestCase):
    def test_loads_a_valid_taskset_by_split(self):
        directory = write_taskset(self, [make_task(1), make_task(2, split="dev")])

        taskset = load_taskset(directory)

        self.assertEqual([task.id for task in taskset.by_split["train"]], [task_id(1)])
        self.assertEqual([task.id for task in taskset.by_split["dev"]], [task_id(2)])
        self.assertEqual(taskset.by_split["test"], ())
        self.assertEqual(taskset.metadata["exportId"], "export_test")

    def test_loads_a_reference_followed_by_four_candidates(self):
        task = make_task(1)
        task["images"] = [reference()] + [candidate(size, theme) for size, theme in RENDERINGS]

        (loaded,) = load_taskset(write_taskset(self, [task])).tasks

        self.assertEqual(
            [(image.role, image.size, image.theme) for image in loaded.images],
            [("reference", None, None)] + [("candidate", *rendering) for rendering in RENDERINGS],
        )

    def test_refuses_an_invalid_task_and_names_its_line(self):
        def change_image(**fields):
            return lambda task: task["images"][0].update(fields)

        def set_images(*images):
            return lambda task: task.update(images=list(images))

        cases = {
            "parent segment": (
                change_image(path="../screen.png"),
                r'image path "\.\./screen\.png" has a \.\. segment',
            ),
            "absolute path": (
                change_image(path="/etc/hosts"),
                r'image path "/etc/hosts" is absolute',
            ),
            "digest mismatch": (
                change_image(digest=digest(b"other bytes")),
                r'image "images/screen\.png" has digest sha256:[0-9a-f]{64}, but the task names',
            ),
            "label for no question": (
                lambda task: task["labels"].update(severity={"answer": 1}),
                r'label "severity" names no question',
            ),
            "repeated size and theme": (
                set_images(candidate("narrow", "dark"), candidate("narrow", "dark")),
                r"images list two narrow dark candidates",
            ),
            "candidate without size": (
                lambda task: task["images"][0].pop("size"),
                r"a candidate image is missing size",
            ),
            "reference with size": (
                set_images(reference(size="desktop"), candidate()),
                r"a reference image must not have size or theme",
            ),
            "five candidates": (
                set_images(*[candidate(*rendering) for rendering in RENDERINGS], candidate()),
                r"images must list 1 to 4 candidates",
            ),
            "reference after a candidate": (
                set_images(candidate(), reference()),
                r"the reference image must come first",
            ),
        }
        for name, (change, message) in cases.items():
            with self.subTest(name):
                invalid = make_task(2)
                change(invalid)
                directory = write_taskset(self, [make_task(1), invalid])
                with self.assertRaisesRegex(TasksetError, r"^tasks\.jsonl line 2: " + message):
                    load_taskset(directory)

    def test_refuses_a_symlink_that_leaves_the_directory(self):
        outside = write_taskset(self, [make_task(1)])
        task = make_task(1)
        task["images"][0]["path"] = "images/link.png"
        directory = write_taskset(self, [task])
        (directory / "images" / "link.png").symlink_to(outside / "images" / "screen.png")

        with self.assertRaisesRegex(
            TasksetError, r'line 1: image path "images/link\.png" leaves the taskset directory'
        ):
            load_taskset(directory)

    def test_refuses_a_repeated_task_id(self):
        directory = write_taskset(self, [make_task(1), make_task(1)])

        with self.assertRaisesRegex(TasksetError, rf"line 2: task id {task_id(1)} repeats line 1"):
            load_taskset(directory)
