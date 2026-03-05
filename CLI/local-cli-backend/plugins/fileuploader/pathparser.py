from typing import List

def _parse(path: str, dest: List[str]) -> None:
    dest.clear()

    # Clear leading symbols
    if len(path) <= 0:
        return
    if path[0] == '.':
        path = path[1:]
    if len(path) <= 0:
        return
    if path[0] == '/' or path[0] == '\\':
        path = path[1:]
    if len(path) <= 0:
        return
    
    if len(path.split('/')) > 1:
        parsed_elements = path.split('/')
    elif len(path.split('\\')) > 1:
        parsed_elements = path.split('\\')
    else:
        return

    found_ext = False
    for element in parsed_elements:
        if found_ext:
            dest.clear()
            raise ValueError("Cannot have file be child of another file")
        if len(element.split('.')) > 2:
            dest.clear()
            raise ValueError("Cannot have two extensions in filename")
        ext_index = element.find('.')
        if ext_index >= 0:
            if ext_index == 0:
                dest.clear()
                raise ValueError("File must have name before extension")
            found_ext = True
        dest.append(element)


class PathParser:
    def __init__(self, path: str) -> None:
        self.elements: List[str] = []
        _parse(path, self.elements)

    def __repr__(self) -> str:
        if len(self.elements) > 0:
            return f"./{'/'.join(self.elements)}"
        return "."

    def stem(self) -> str | None:
        if len(self.elements)  > 0:
            return self.elements[-1]
        return None

    def append(self, new_element: str) -> None:
        self.elements.append(new_element)

    def parent(self) -> "PathParser":
        res = PathParser("")
        if (len(self.elements) > 1):
            res.elements = self.elements[:-1]
        else:
            res.elements = []
        return res
    
    def hasExt(self) -> bool:
        if len(self.elements) > 0:
            return '.' in self.elements[-1]
        return False
    
    def getExt(self) -> str | None:
        if self.hasExt():
            return 